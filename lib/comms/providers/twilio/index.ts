import { CommsError } from "@/lib/domain/ports/comms";

import { commsCallbackUrl } from "../../callbacks";
import {
  browserCallingConfigured,
  providerConfigured,
  voiceAgentConfigured,
  type CommsConfig,
} from "../../config";
import { carrierRequest, readCapped, type Fetch } from "../../http";
import type { CommsAdapter } from "../../types";
import { voiceAgentStream } from "../../voice-agent/stream";
import { parseTwilioWebhook, TWILIO_WEBHOOK_EVENTS } from "./parse";
import { verifyTwilioSignature } from "./signature";
import { twilioVoiceAccessToken } from "./token";
import { renderTwiml, type TwimlContext } from "./twiml";

// The Twilio adapter (file 02). Raw HTTPS against the 2010-04-01 REST API —
// no SDK — form-encoded bodies, Basic auth with an API key when there is one.
// Call control is markup: the webhook's response is the TwiML.

function describeTwilioError(json: unknown): {
  code: string | null;
  message: string | null;
} {
  const body = (json ?? {}) as { code?: unknown; message?: unknown };
  return {
    code:
      typeof body.code === "number" || typeof body.code === "string"
        ? String(body.code)
        : null,
    message:
      typeof body.message === "string" ? body.message.slice(0, 200) : null,
  };
}

export function createTwilioAdapter(
  config: CommsConfig,
  fetchImpl: Fetch = fetch,
): CommsAdapter {
  const t = config.twilio;
  const configured =
    providerConfigured(config, "twilio") && Boolean(config.webhookOrigin);
  const origin = config.webhookOrigin ?? "";
  const user = t.apiKeySid && t.apiKeySecret ? t.apiKeySid : t.accountSid;
  const pass = t.apiKeySid && t.apiKeySecret ? t.apiKeySecret : t.authToken;
  const auth = `Basic ${Buffer.from(`${user ?? ""}:${pass ?? ""}`).toString("base64")}`;
  const account = `${t.apiBase}/2010-04-01/Accounts/${encodeURIComponent(t.accountSid ?? "")}`;

  async function rest(
    method: "GET" | "POST" | "DELETE",
    path: string,
    what: string,
    form?: URLSearchParams,
  ): Promise<Record<string, unknown>> {
    if (!configured) {
      throw new CommsError(
        "Twilio isn't configured in this runtime.",
        "config",
        "TWILIO_CONFIG",
      );
    }
    const response = await carrierRequest(
      fetchImpl,
      {
        body: form?.toString(),
        headers: {
          Authorization: auth,
          ...(form
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        method,
        provider: "TWILIO",
        url: `${account}${path}`,
        what,
      },
      describeTwilioError,
    );
    return (response.json ?? {}) as Record<string, unknown>;
  }

  const callback = (event: string, callId: string | null) =>
    commsCallbackUrl(origin, "twilio", event, { callId });

  const browserCalling =
    config.callsEnabled && browserCallingConfigured(config, "twilio");
  const voiceAgent =
    configured && config.callsEnabled && voiceAgentConfigured(config);

  const twimlContext = (
    callSid: string | null,
    callId: string | null,
  ): TwimlContext => ({
    agentStream: (maxSeconds) => {
      if (!callSid) {
        throw new CommsError(
          "There is no call to stream to Mili.",
          "unsupported",
          "TWILIO_NO_CALL",
        );
      }
      return voiceAgentStream(config, "twilio", {
        callId,
        maxSeconds,
        providerCallId: callSid,
      });
    },
    callId,
    origin,
  });

  const notFound = (error: unknown) =>
    error instanceof CommsError && error.providerCode === "TWILIO_20404";

  return {
    capabilities: {
      browserCalling,
      browserSdkBundled: true,
      callControl: "markup",
      inboundCallFlow: true,
      outboundCalls: configured,
      recordings: configured,
      sms: configured,
      voiceAgent,
    },
    issueBrowserCredential: browserCalling
      ? async (identity, ttlSeconds) => ({
          identity,
          options: { edge: t.edge },
          provider: "twilio",
          token: twilioVoiceAccessToken({
            accountSid: t.accountSid ?? "",
            apiKeySecret: t.apiKeySecret ?? "",
            apiKeySid: t.apiKeySid ?? "",
            identity,
            ttlSeconds,
          }),
          ttlSeconds,
        })
      : null,
    iceServers: configured
      ? async () => {
          // Network Traversal Service: TURN credentials that last an hour.
          const token = await rest(
            "POST",
            "/Tokens.json",
            "fetching TURN servers",
            new URLSearchParams({ Ttl: "3600" }),
          );
          const servers = Array.isArray(token.ice_servers)
            ? (token.ice_servers as Record<string, unknown>[])
            : [];
          return servers
            .filter(
              (server) =>
                typeof server.urls === "string"
                || typeof server.url === "string",
            )
            .map((server) => ({
              credential:
                typeof server.credential === "string"
                  ? server.credential
                  : undefined,
              urls: String(server.urls ?? server.url),
              username:
                typeof server.username === "string"
                  ? server.username
                  : undefined,
            }));
        }
      : undefined,
    name: "twilio",
    parseWebhook: parseTwilioWebhook,
    recordings: configured
      ? {
          deleteRecording: async (recordingSid) => {
            try {
              await rest(
                "DELETE",
                `/Recordings/${encodeURIComponent(recordingSid)}.json`,
                "deleting a recording",
              );
            } catch (error) {
              // Already gone is the end state the caller wants.
              if (
                error instanceof CommsError
                && error.providerCode === "TWILIO_20404"
              )
                return;
              throw error;
            }
          },
          fetchRecording: async (recordingSid, options) => {
            if (!configured) {
              throw new CommsError(
                "Twilio isn't configured in this runtime.",
                "config",
                "TWILIO_CONFIG",
              );
            }
            // Built from the SID, never from the callback's RecordingUrl.
            const url = `${account}/Recordings/${encodeURIComponent(recordingSid)}.mp3`;
            let response: Response;
            try {
              response = await fetchImpl(url, {
                headers: { Authorization: auth },
                signal: AbortSignal.timeout(60_000),
              });
            } catch {
              throw new CommsError(
                "Twilio didn't return the recording in time.",
                "uncertain",
                "TWILIO_TIMEOUT",
              );
            }
            if (!response.ok) {
              throw new CommsError(
                `Twilio refused the recording download (HTTP ${response.status}).`,
                response.status >= 400 && response.status < 500
                  ? "rejected"
                  : "uncertain",
                `TWILIO_HTTP_${response.status}`,
              );
            }
            return {
              bytes: await readCapped(response, options.maxBytes, "TWILIO"),
              mimeType: "audio/mpeg",
            };
          },
          provider: "twilio",
        }
      : null,
    respond: async (instructions, context) =>
      new Response(
        renderTwiml(
          instructions,
          twimlContext(context.providerCallId, context.callId),
        ),
        {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/xml; charset=utf-8",
          },
          status: 200,
        },
      ),
    sms:
      configured && config.smsEnabled
        ? {
            provider: "twilio",
            sendSms: async ({ body, from, to }) => {
              const result = await rest(
                "POST",
                "/Messages.json",
                "the text",
                new URLSearchParams({
                  Body: body,
                  From: from,
                  StatusCallback: callback("sms-status", null),
                  To: to,
                }),
              );
              const sid = typeof result.sid === "string" ? result.sid : null;
              if (!sid) {
                throw new CommsError(
                  "Twilio accepted the text but returned no id.",
                  "uncertain",
                  "TWILIO_NO_SID",
                );
              }
              return { providerMessageId: sid };
            },
          }
        : null,
    startCallRecording: async (callSid, callId) => {
      // Both sides of the conversation with Mili. The status callback is
      // marked so a late save is filed as the conversation, not a voicemail.
      await rest(
        "POST",
        `/Calls/${encodeURIComponent(callSid)}/Recordings.json`,
        "recording the call",
        new URLSearchParams({
          RecordingChannels: "dual",
          RecordingStatusCallback: commsCallbackUrl(
            origin,
            "twilio",
            "voice-recording",
            { callId, kind: "call" },
          ),
          RecordingStatusCallbackEvent: "completed",
          RecordingStatusCallbackMethod: "POST",
        }),
      );
    },
    updateLiveCall: async (callSid, callId, instructions) => {
      // A voicemail is about to record on its own: stop the conversation's
      // recording first. Already stopped (or never started) is fine.
      if (
        instructions.some(
          (step) => step.op === "stopAgent" && step.stopRecording,
        )
      ) {
        try {
          await rest(
            "POST",
            `/Calls/${encodeURIComponent(callSid)}/Recordings/Twilio.CURRENT.json`,
            "stopping the call recording",
            new URLSearchParams({ Status: "stopped" }),
          );
        } catch (error) {
          if (!notFound(error)) throw error;
        }
      }
      // New TwiML on the live call: it ends the stream to Mili and runs the
      // next steps (VERIFY: <Connect>'s action is not requested after it).
      await rest(
        "POST",
        `/Calls/${encodeURIComponent(callSid)}.json`,
        "moving the call on from Mili",
        new URLSearchParams({
          Twiml: renderTwiml(instructions, twimlContext(callSid, callId)),
        }),
      );
    },
    verifyWebhook: (request) =>
      verifyTwilioSignature({
        authTokens: [t.authToken, t.previousAuthToken],
        headers: request.headers,
        params: new URLSearchParams(request.rawBody),
        url: request.signedUrl,
      }),
    voice:
      configured && config.callsEnabled
        ? {
            endCall: async (callSid) => {
              const lookup = await rest(
                "GET",
                `/Calls/${encodeURIComponent(callSid)}.json`,
                "looking up the call",
              );
              const status = String(lookup.status ?? "");
              if (
                [
                  "completed",
                  "busy",
                  "no-answer",
                  "failed",
                  "canceled",
                ].includes(status)
              )
                return;
              await rest(
                "POST",
                `/Calls/${encodeURIComponent(callSid)}.json`,
                "ending the call",
                new URLSearchParams({
                  Status: status === "in-progress" ? "completed" : "canceled",
                }),
              );
            },
            lookupCall: async (callSid) => {
              try {
                const call = await rest(
                  "GET",
                  `/Calls/${encodeURIComponent(callSid)}.json`,
                  "looking up the call",
                );
                const status = String(call.status ?? "");
                const alive = [
                  "queued",
                  "initiated",
                  "ringing",
                  "in-progress",
                ].includes(status);
                const duration = Number(call.duration);
                return {
                  alive,
                  durationSeconds:
                    Number.isFinite(duration) && call.duration !== null
                      ? duration
                      : null,
                  found: true,
                  state: alive ? null : (status as "completed"),
                };
              } catch (error) {
                if (
                  error instanceof CommsError
                  && error.providerCode === "TWILIO_20404"
                ) {
                  return { found: false };
                }
                throw error;
              }
            },
            placeCall: async (request) => {
              const form = new URLSearchParams({
                From: request.from,
                Method: "POST",
                StatusCallback: callback("voice-status", request.callId),
                StatusCallbackMethod: "POST",
                TimeLimit: String(request.timeLimitSeconds),
                Timeout: String(request.timeoutSeconds),
                To: request.to,
                Url: callback("voice-connect", request.callId),
              });
              for (const event of [
                "initiated",
                "ringing",
                "answered",
                "completed",
              ]) {
                form.append("StatusCallbackEvent", event);
              }
              const result = await rest(
                "POST",
                "/Calls.json",
                "the call",
                form,
              );
              const sid = typeof result.sid === "string" ? result.sid : null;
              if (!sid) {
                throw new CommsError(
                  "Twilio accepted the call but returned no id.",
                  "uncertain",
                  "TWILIO_NO_SID",
                );
              }
              return { providerCallId: sid };
            },
            provider: "twilio",
          }
        : null,
    webhookEvents: TWILIO_WEBHOOK_EVENTS,
  };
}
