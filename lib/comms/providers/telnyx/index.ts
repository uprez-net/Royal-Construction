import { CommsError, type CallInstruction } from "@/lib/domain/ports/comms";

import { commsCallbackUrl } from "../../callbacks";
import { browserCallingConfigured, providerConfigured, type CommsConfig } from "../../config";
import { carrierRequest, readCapped, type Fetch } from "../../http";
import type { CommsAdapter, RespondContext } from "../../types";
import { encodeClientState } from "./client-state";
import { parseTelnyxWebhook, TELNYX_WEBHOOK_EVENTS } from "./parse";
import { verifyTelnyxSignature } from "./signature";

// The Telnyx adapter (file 07). Raw HTTPS against API v2 — no SDK — JSON
// bodies, Bearer auth, Ed25519-signed webhooks.
//
// Call control is commands, not markup (file 06 §3.1): Telnyx posts an event,
// Royal answers 200, and acts by issuing REST commands on the live call. The
// same neutral instructions the Twilio adapter renders as TwiML are executed
// here one at a time. A command that finishes later (speech, a recording)
// carries the rest of the instructions in its client_state, and the
// matching ".ended"/".saved" event continues them.
//
// Every request and response field below is marked VERIFY in file 07: the
// names come from the docs index and OpenAPI spec, not a captured request.

const API = "https://api.telnyx.com/v2";
const VOICE = { language: "en-AU", voice: "female" } as const;

function describeTelnyxError(json: unknown): { code: string | null; message: string | null } {
  const first = ((json ?? {}) as { errors?: { code?: unknown; title?: unknown; detail?: unknown }[] }).errors?.[0];
  return {
    code: typeof first?.code === "string" || typeof first?.code === "number" ? String(first.code) : null,
    message:
      typeof first?.detail === "string"
        ? first.detail.slice(0, 200)
        : typeof first?.title === "string"
          ? first.title.slice(0, 200)
          : null,
  };
}

/** One credential per identity, looked up once per process. */
const sipUsernames = new Map<string, string>();

export function createTelnyxAdapter(config: CommsConfig, fetchImpl: Fetch = fetch): CommsAdapter {
  const t = config.telnyx;
  const configured = providerConfigured(config, "telnyx") && Boolean(config.webhookOrigin);
  const callsConfigured = configured && Boolean(t.connectionId);
  const origin = config.webhookOrigin ?? "";
  const browserCalling = config.callsEnabled && browserCallingConfigured(config, "telnyx");

  async function rest(
    method: "GET" | "POST" | "DELETE",
    path: string,
    what: string,
    body?: Record<string, unknown>,
  ) {
    if (!configured) {
      throw new CommsError("Telnyx isn't configured in this runtime.", "config", "TELNYX_CONFIG");
    }
    return carrierRequest(
      fetchImpl,
      {
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${t.apiKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        method,
        provider: "TELNYX",
        url: `${API}${path}`,
        what,
      },
      describeTelnyxError,
    );
  }

  const data = (json: unknown) => ((json ?? {}) as { data?: Record<string, unknown> }).data ?? {};
  const action = (id: string, name: string, what: string, body: Record<string, unknown> = {}) =>
    rest("POST", `/calls/${encodeURIComponent(id)}/actions/${name}`, what, body);
  const voiceUrl = (callId: string | null) => commsCallbackUrl(origin, "telnyx", "voice", { callId });

  /** The telephony credential for a browser identity, created on first use. */
  async function credentialFor(identity: string): Promise<{ id: string; sipUsername: string }> {
    const found = await rest(
      "GET",
      `/telephony_credentials?filter[tag]=${encodeURIComponent(identity)}&page[size]=1`,
      "looking up a browser credential",
    );
    const existing = ((found.json ?? {}) as { data?: Record<string, unknown>[] }).data?.[0];
    const record =
      existing
      ?? data(
        (
          await rest("POST", "/telephony_credentials", "creating a browser credential", {
            connection_id: t.webrtcConnectionId,
            name: identity,
            tag: identity,
          })
        ).json,
      );
    const id = typeof record.id === "string" ? record.id : null;
    const sipUsername = typeof record.sip_username === "string" ? record.sip_username : null;
    if (!id || !sipUsername) {
      throw new CommsError("Telnyx returned a browser credential without an id.", "uncertain", "TELNYX_NO_CREDENTIAL");
    }
    sipUsernames.set(identity, sipUsername);
    return { id, sipUsername };
  }

  async function sipUriFor(identity: string): Promise<string> {
    const cached = sipUsernames.get(identity);
    const username = cached ?? (await credentialFor(identity)).sipUsername;
    return `sip:${username}@sip.telnyx.com`;
  }

  /**
   * Issue instructions on a live call. Synchronous commands run in order;
   * the first asynchronous one carries the rest in its client_state.
   */
  async function execute(
    callControlId: string,
    callId: string | null,
    instructions: readonly CallInstruction[],
  ): Promise<void> {
    for (let index = 0; index < instructions.length; index += 1) {
      const step = instructions[index];
      const rest = instructions.slice(index + 1);
      const stateA = (n?: readonly CallInstruction[]) =>
        encodeClientState({ c: callId ?? undefined, r: "a", ...(n?.length ? { n: [...n] } : {}) });
      switch (step.op) {
        case "say":
          await action(callControlId, "speak", "speaking to the caller", {
            ...VOICE,
            client_state: stateA(rest),
            payload: step.text,
          });
          return;
        case "gatherDigits":
          await action(callControlId, "gather_using_speak", "asking the caller to press a key", {
            ...VOICE,
            client_state: stateA(),
            maximum_digits: step.numDigits,
            minimum_digits: 1,
            payload: step.prompt,
            timeout_millis: step.timeoutSeconds * 1000,
            valid_digits: "0123456789*#",
          });
          return;
        case "dialBrowser":
        case "dialNumber": {
          // Telnyx transfers to one destination. With several staff browsers
          // the most recently seen one rings (capabilities.browserRingGroup).
          const to =
            step.op === "dialNumber"
              ? step.to
              : step.identities[0]
                ? await sipUriFor(step.identities[0])
                : null;
          if (!to) {
            throw new CommsError("There is no staff browser to ring.", "unsupported", "TELNYX_NO_TARGET");
          }
          await action(callControlId, "transfer", "putting the caller through", {
            client_state: encodeClientState({
              a: callControlId,
              c: callId ?? undefined,
              r: "b",
              ...(step.record ? { rec: 1 as const } : {}),
            }),
            ...(step.op === "dialBrowser" && callId
              ? { custom_headers: [{ name: "X-Royal-Call-Id", value: callId }] }
              : {}),
            from: step.callerId,
            timeout_secs: step.timeoutSeconds,
            to,
            webhook_url: voiceUrl(callId),
          });
          return;
        }
        case "recordVoicemail":
          await action(callControlId, "record_start", "recording a voicemail", {
            channels: "single",
            client_state: stateA(rest),
            format: "mp3",
            max_length: step.maxSeconds,
            play_beep: true,
            timeout_secs: 5,
          });
          return;
        case "hangup":
          await hangup(callControlId);
          return;
      }
    }
  }

  async function hangup(callControlId: string): Promise<void> {
    try {
      await action(callControlId, "hangup", "ending the call");
    } catch (error) {
      // 422: the call already ended, which is what was asked for.
      if (error instanceof CommsError && error.kind === "rejected") return;
      throw error;
    }
  }

  async function respond(
    instructions: readonly CallInstruction[] | null,
    context: RespondContext,
  ): Promise<Response> {
    const ok = new Response(null, { headers: { "Cache-Control": "no-store" }, status: 200 });
    if (!context.providerCallId) return ok;
    try {
      if (context.trigger === "call.incoming") {
        // An incoming call is answered first; its `call.answered` event asks
        // the domain for the first step (file 07 §5).
        if (instructions && instructions.length > 0) {
          await action(context.providerCallId, "answer", "answering the call", {
            client_state: encodeClientState({ c: context.callId ?? undefined, r: "a" }),
            webhook_url: voiceUrl(context.callId),
          });
        }
        return ok;
      }
      if (instructions?.length) await execute(context.providerCallId, context.callId, instructions);
    } catch (error) {
      // Answer 200 regardless: a retried event finds the flow already moved
      // on, so a retry cannot issue the command either. The stale-call sweep
      // settles a call left hanging; the log says why.
      console.error(
        `[comms:telnyx] A call command failed (${error instanceof CommsError ? error.providerCode : "error"}).`,
      );
    }
    return ok;
  }

  return {
    capabilities: {
      browserCalling,
      browserRingGroup: false,
      browserSdkBundled: true,
      callControl: "commands",
      inboundCallFlow: true,
      outboundCalls: callsConfigured,
      recordings: configured,
      sms: configured,
    },
    issueBrowserCredential: browserCalling
      ? async (identity, ttlSeconds) => {
          const credential = await credentialFor(identity);
          const token = await rest(
            "POST",
            `/telephony_credentials/${encodeURIComponent(credential.id)}/token`,
            "issuing a browser login",
          );
          // The token endpoint answers the JWT as plain text. VERIFY.
          const jwt = token.text.trim().replace(/^"|"$/g, "");
          if (!jwt) {
            throw new CommsError("Telnyx returned an empty browser login.", "uncertain", "TELNYX_NO_TOKEN");
          }
          return { identity, options: { mode: "login_token" }, provider: "telnyx", token: jwt, ttlSeconds };
        }
      : null,
    name: "telnyx",
    parseWebhook: parseTelnyxWebhook,
    recordings: configured
      ? {
          deleteRecording: async (recordingId) => {
            try {
              await rest("DELETE", `/recordings/${encodeURIComponent(recordingId)}`, "deleting a recording");
            } catch (error) {
              if (error instanceof CommsError && error.providerCode === "TELNYX_HTTP_404") return;
              throw error;
            }
          },
          fetchRecording: async (recordingId, options) => {
            // Ask for a fresh download link by id; the one in the callback
            // expires within minutes and is never fetched (SSRF).
            const found = data((await rest("GET", `/recordings/${encodeURIComponent(recordingId)}`, "finding a recording")).json);
            const urls = (found.download_urls ?? {}) as Record<string, unknown>;
            const url = typeof urls.mp3 === "string" ? urls.mp3 : null;
            if (!url || !url.startsWith("https://")) {
              throw new CommsError("Telnyx gave no download link for the recording.", "rejected", "TELNYX_NO_DOWNLOAD");
            }
            let response: Response;
            try {
              response = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
            } catch {
              throw new CommsError("The recording didn't download in time.", "uncertain", "TELNYX_TIMEOUT");
            }
            if (!response.ok) {
              throw new CommsError(
                `The recording download failed (HTTP ${response.status}).`,
                "uncertain",
                `TELNYX_HTTP_${response.status}`,
              );
            }
            return { bytes: await readCapped(response, options.maxBytes, "TELNYX"), mimeType: "audio/mpeg" };
          },
          provider: "telnyx",
        }
      : null,
    respond,
    sms:
      configured && config.smsEnabled
        ? {
            provider: "telnyx",
            sendSms: async ({ body, from, to }) => {
              const result = data(
                (
                  await rest("POST", "/messages", "the text", {
                    from,
                    text: body,
                    to,
                    webhook_url: commsCallbackUrl(origin, "telnyx", "sms"),
                    ...(t.messagingProfileId ? { messaging_profile_id: t.messagingProfileId } : {}),
                  })
                ).json,
              );
              const id = typeof result.id === "string" ? result.id : null;
              if (!id) {
                throw new CommsError("Telnyx accepted the text but returned no id.", "uncertain", "TELNYX_NO_ID");
              }
              return { providerMessageId: id };
            },
          }
        : null,
    startCallRecording: async (callControlId, callId) => {
      await action(callControlId, "record_start", "recording the call", {
        channels: "dual",
        client_state: encodeClientState({ c: callId ?? undefined, r: "a" }),
        format: "mp3",
      });
    },
    verifyWebhook: (request) =>
      verifyTelnyxSignature({
        headers: request.headers,
        now: request.now,
        publicKey: t.publicKey,
        rawBody: request.rawBody,
      }),
    voice:
      callsConfigured && config.callsEnabled
        ? {
            endCall: hangup,
            lookupCall: async (callControlId) => {
              try {
                const call = data((await rest("GET", `/calls/${encodeURIComponent(callControlId)}`, "looking up the call")).json);
                const alive = call.is_alive === true;
                const duration = Number(call.call_duration);
                return {
                  alive,
                  durationSeconds: !alive && Number.isFinite(duration) ? duration : null,
                  found: true,
                  // Telnyx only says whether the call is alive (file 07 §5).
                  state: null,
                };
              } catch (error) {
                // The call was placed (it has an id), so a 404 means Telnyx
                // has forgotten it: it ended, how is unknown. VERIFY.
                if (error instanceof CommsError && error.providerCode?.endsWith("404")) {
                  return { alive: false, durationSeconds: null, found: true, state: null };
                }
                throw error;
              }
            },
            placeCall: async (request) => {
              const result = data(
                (
                  await rest("POST", "/calls", "the call", {
                    client_state: encodeClientState({ c: request.callId, r: "a" }),
                    connection_id: t.connectionId,
                    from: request.from,
                    time_limit_secs: request.timeLimitSeconds,
                    timeout_secs: request.timeoutSeconds,
                    to: request.to,
                    webhook_url: voiceUrl(request.callId),
                    webhook_url_method: "POST",
                  })
                ).json,
              );
              const id = typeof result.call_control_id === "string" ? result.call_control_id : null;
              if (!id) {
                throw new CommsError("Telnyx accepted the call but returned no id.", "uncertain", "TELNYX_NO_ID");
              }
              return { providerCallId: id };
            },
            provider: "telnyx",
          }
        : null,
    webhookEvents: TELNYX_WEBHOOK_EVENTS,
  };
}
