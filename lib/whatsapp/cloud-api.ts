import {
  WhatsAppMediaError,
  WhatsAppSendError,
  type WhatsAppCallsPort,
  type WhatsAppGroupsPort,
  type WhatsAppGroupSummary,
  type WhatsAppMediaPort,
  type WhatsAppPort,
  type WhatsAppSendReceipt,
} from "@/lib/domain/ports/whatsapp";

import { readWhatsAppConfig, type WhatsAppConfig } from "./config";
import { describeWhatsAppError } from "./errors";

// The Meta WhatsApp Cloud API behind `WhatsAppPort` (issue #333).
//
// Plain `fetch` — no SDK, no `server-only`, nothing Node's ESM loader cannot
// load — because Eve builds this into its own bundle and the App calls it from
// route handlers. Both construct it with `createWhatsAppPortFromEnv()`.
//
// The one judgement this module makes is whether a failure means "nothing was
// sent" or "it might have been". Meta has no idempotency key for sends, so an
// ambiguous failure cannot be safely retried; the domain holds it for a person
// (lib/domain/leads/whatsapp/send.ts). Logs carry codes and trace ids, never a
// token, a body or a customer's number.
//
// The same judgement covers creating a group: a create that timed out may
// have made one, and the domain looks for it before asking again.

const SEND_TIMEOUT_MS = 15_000;
const MEDIA_TIMEOUT_MS = 60_000;

/** Network failures that happen before a request can reach Meta at all. */
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

type Fetch = typeof fetch;

type MetaErrorBody = {
  error?: {
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
    fbtrace_id?: string;
  };
};

type MetaSendBody = {
  messages?: { id?: string }[];
};

type Json = Record<string, unknown>;

function causeCode(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * One Graph API call. Answers the parsed body on success; throws
 * `WhatsAppSendError` otherwise, classified `not_sent` (Meta refused, or was
 * never reached) or `ambiguous` (it may have acted).
 */
async function graph(
  config: Pick<WhatsAppConfig, "accessToken" | "apiVersion">,
  request: {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly body?: Json;
    /** What the log line calls this call. */
    readonly what: string;
  },
  fetchImpl: Fetch,
): Promise<Json> {
  if (!config.accessToken) {
    throw new WhatsAppSendError(
      "WhatsApp sending isn't configured in this runtime.",
      "not_sent",
      { unreachable: true },
    );
  }
  const url = `https://graph.facebook.com/${config.apiVersion}/${request.path}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      body: request.body ? JSON.stringify(request.body) : undefined,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        ...(request.body ? { "Content-Type": "application/json" } : {}),
      },
      method: request.method,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    const code = causeCode(error);
    if (code && UNREACHABLE_CODES.has(code)) {
      console.warn(
        `[whatsapp] Meta unreachable before ${request.what} (${code}).`,
      );
      throw new WhatsAppSendError(
        "WhatsApp couldn't be reached from this server, so nothing was sent.",
        "not_sent",
        { code: code, unreachable: true },
      );
    }
    // A timeout or a reset after the request left: Meta may have accepted it.
    console.warn(
      `[whatsapp] ${request.what} outcome unknown (${code ?? (error as Error)?.name ?? "error"}).`,
    );
    throw new WhatsAppSendError(
      "WhatsApp didn't answer in time; the message may or may not have been sent.",
      "ambiguous",
      { code: code ?? undefined },
    );
  }

  const text = await response.text().catch(() => "");
  let body: (Json & MetaErrorBody) | null = null;
  try {
    body = text ? (JSON.parse(text) as Json & MetaErrorBody) : null;
  } catch {
    body = null;
  }

  if (response.ok) return body ?? {};

  const code = body?.error?.code;
  console.warn(
    `[whatsapp] Meta refused ${request.what}: HTTP ${response.status}, code ${code ?? "none"}, trace ${body?.error?.fbtrace_id ?? "none"}.`,
  );
  // 5xx: Meta's side failed mid-request, and may have acted on it.
  if (response.status >= 500) {
    throw new WhatsAppSendError(
      "WhatsApp had a server error; the message may or may not have been sent.",
      "ambiguous",
      { code: code !== undefined ? String(code) : undefined },
    );
  }
  // 4xx: validated and refused before acceptance. Nothing happened.
  throw new WhatsAppSendError(
    describeWhatsAppError(code, body?.error?.title ?? body?.error?.message),
    "not_sent",
    {
      code: code !== undefined ? String(code) : undefined,
      title: body?.error?.title ?? undefined,
    },
  );
}

async function sendMessage(
  config: Pick<WhatsAppConfig, "accessToken" | "apiVersion">,
  phoneNumberId: string,
  payload: Json,
  fetchImpl: Fetch,
): Promise<WhatsAppSendReceipt> {
  const body = (await graph(
    config,
    {
      body: { messaging_product: "whatsapp", ...payload },
      method: "POST",
      path: `${encodeURIComponent(phoneNumberId)}/messages`,
      what: "a send",
    },
    fetchImpl,
  )) as MetaSendBody;
  const id = body.messages?.[0]?.id;
  if (id) return { providerMessageId: id };
  console.warn("[whatsapp] Meta accepted a send without a message id.");
  throw new WhatsAppSendError(
    "WhatsApp accepted the request but returned no message id; it may or may not have been sent.",
    "ambiguous",
  );
}

function createGroupsPort(
  config: WhatsAppConfig,
  fetchImpl: Fetch,
): WhatsAppGroupsPort {
  return {
    create: async (request) => {
      const body = await graph(
        config,
        {
          body: {
            description: request.description,
            messaging_product: "whatsapp",
            subject: request.subject,
          },
          method: "POST",
          path: `${encodeURIComponent(request.fromPhoneNumberId)}/groups`,
          what: "a group create",
        },
        fetchImpl,
      );
      return {
        groupId: stringOrNull(body.group_id) ?? stringOrNull(body.id),
        inviteLink: stringOrNull(body.invite_link),
        requestId: stringOrNull(body.request_id),
      };
    },
    info: async (groupId) => {
      const body = await graph(
        config,
        {
          method: "GET",
          path: `${encodeURIComponent(groupId)}?fields=subject,suspended,participants`,
          what: "a group read",
        },
        fetchImpl,
      );
      const participants = Array.isArray(body.participants)
        ? body.participants
        : [];
      return {
        groupId,
        participantWaIds: participants
          .map((row) => stringOrNull((row as Json)?.wa_id))
          .filter((id): id is string => Boolean(id)),
        subject: stringOrNull(body.subject) ?? "",
        suspended: body.suspended === true || body.suspended === "true",
      };
    },
    inviteLink: async (groupId) => {
      const body = await graph(
        config,
        {
          method: "GET",
          path: `${encodeURIComponent(groupId)}/invite_link`,
          what: "an invite-link read",
        },
        fetchImpl,
      );
      const link = stringOrNull(body.invite_link);
      if (!link) {
        throw new WhatsAppSendError(
          "WhatsApp returned no invite link for this group.",
          "not_sent",
        );
      }
      return link;
    },
    list: async (phoneNumberId) => {
      const groups: WhatsAppGroupSummary[] = [];
      let after: string | null = null;
      // A business number holds at most a few hundred project groups; ten
      // pages of 100 is far beyond what this business will ever have.
      for (let page = 0; page < 10; page += 1) {
        const query = new URLSearchParams({ limit: "100" });
        if (after) query.set("after", after);
        const body = await graph(
          config,
          {
            method: "GET",
            path: `${encodeURIComponent(phoneNumberId)}/groups?${query.toString()}`,
            what: "a group list",
          },
          fetchImpl,
        );
        const data = (body.data ?? {}) as { groups?: unknown };
        const rows = Array.isArray(data.groups) ? data.groups : [];
        for (const row of rows as Json[]) {
          const groupId = stringOrNull(row.id);
          if (!groupId) continue;
          const created = stringOrNull(row.created_at);
          const seconds =
            created && /^\d+$/.test(created) ? Number(created) : null;
          groups.push({
            createdAt:
              seconds !== null
                ? new Date(seconds * 1000)
                : created
                  ? new Date(created)
                  : null,
            groupId,
            subject: stringOrNull(row.subject) ?? "",
          });
        }
        const paging = body.paging as
          | { next?: unknown; cursors?: { after?: unknown } }
          | undefined;
        after = paging?.next ? stringOrNull(paging.cursors?.after) : null;
        if (!after) break;
      }
      return groups.sort(
        (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      );
    },
    sendText: (message) =>
      sendMessage(
        config,
        message.fromPhoneNumberId,
        {
          recipient_type: "group",
          text: { body: message.body, preview_url: false },
          to: message.groupId,
          type: "text",
        },
        fetchImpl,
      ),
  };
}

/**
 * Meta's Calling API: signalling for calls a staff browser carries over
 * WebRTC. POST /{phone-number-id}/calls with an action (VERIFY the field
 * names against a real call before launch — docs/twilio-plivo-comms/01 §14).
 */
function createCallsPort(
  config: WhatsAppConfig,
  fetchImpl: Fetch,
): WhatsAppCallsPort {
  const call = (phoneNumberId: string, body: Json, what: string) =>
    graph(
      config,
      {
        body: { messaging_product: "whatsapp", ...body },
        method: "POST",
        path: `${encodeURIComponent(phoneNumberId)}/calls`,
        what,
      },
      fetchImpl,
    );
  return {
    accept: async (target) => {
      await call(
        target.fromPhoneNumberId,
        {
          action: "accept",
          call_id: target.providerCallId,
          session: { sdp: target.sdpAnswer, sdp_type: "answer" },
        },
        "accepting a call",
      );
    },
    connect: async (request) => {
      const body = await call(
        request.fromPhoneNumberId,
        {
          action: "connect",
          biz_opaque_callback_data: request.bizOpaqueCallbackData,
          session: { sdp: request.sdpOffer, sdp_type: "offer" },
          to: request.to.replace(/^\+/, ""),
        },
        "placing a call",
      );
      const id = stringOrNull(
        (body.calls as { id?: unknown }[] | undefined)?.[0]?.id,
      );
      if (!id) {
        throw new WhatsAppSendError(
          "WhatsApp accepted the call but returned no call id; it may be ringing.",
          "ambiguous",
        );
      }
      return { providerCallId: id };
    },
    preAccept: async (target) => {
      await call(
        target.fromPhoneNumberId,
        {
          action: "pre_accept",
          call_id: target.providerCallId,
          session: { sdp: target.sdpAnswer, sdp_type: "answer" },
        },
        "pre-accepting a call",
      );
    },
    reject: async (target) => {
      await call(
        target.fromPhoneNumberId,
        { action: "reject", call_id: target.providerCallId },
        "declining a call",
      );
    },
    sendPermissionRequest: (message) =>
      sendMessage(
        config,
        message.fromPhoneNumberId,
        {
          interactive: {
            action: { name: "call_permission_request" },
            body: { text: message.body },
            type: "call_permission_request",
          },
          recipient_type: "individual",
          to: message.to,
          type: "interactive",
        },
        fetchImpl,
      ),
    terminate: async (target) => {
      await call(
        target.fromPhoneNumberId,
        { action: "terminate", call_id: target.providerCallId },
        "ending a call",
      );
    },
  };
}

/** A port over the Cloud API for this configuration. */
export function createCloudApiWhatsAppPort(
  config: WhatsAppConfig,
  fetchImpl: Fetch = fetch,
): WhatsAppPort | null {
  if (!config.enabled || !config.channel) return null;
  return {
    calls:
      config.channel.callingEnabled && config.accessToken
        ? createCallsPort(config, fetchImpl)
        : null,
    channel: config.channel,
    groups:
      config.channel.groupsEnabled && config.accessToken
        ? createGroupsPort(config, fetchImpl)
        : null,
    sendTemplate: (message) =>
      sendMessage(
        config,
        message.fromPhoneNumberId,
        {
          recipient_type: "individual",
          template: {
            components: message.bodyParameters.length
              ? [
                  {
                    parameters: message.bodyParameters.map((text) => ({
                      text,
                      type: "text",
                    })),
                    type: "body",
                  },
                ]
              : [],
            language: { code: message.language },
            name: message.templateName,
          },
          to: message.to,
          type: "template",
        },
        fetchImpl,
      ),
    sendText: (message) =>
      sendMessage(
        config,
        message.fromPhoneNumberId,
        {
          recipient_type: "individual",
          text: { body: message.body, preview_url: false },
          to: message.to,
          type: "text",
        },
        fetchImpl,
      ),
  };
}

/**
 * The production port, or null when WhatsApp is off in this runtime.
 *
 * Null — WhatsApp disabled, no business number, or no access token in this
 * runtime — is an answer the domain handles: a send is refused with "provider
 * unavailable" before anything is written, and reads still show the channel
 * from `whatsappChannelFromEnv()` with `sendingAvailable: false`.
 */
export function createWhatsAppPortFromEnv(
  env: Record<string, string | undefined> = process.env,
): WhatsAppPort | null {
  const config = readWhatsAppConfig(env);
  if (!config.channel?.sendingAvailable) return null;
  return createCloudApiWhatsAppPort(config);
}

// ── Media ─────────────────────────────────────────────────────────────

/** Meta's error codes that mean the media is gone and will not come back. */
const MEDIA_GONE_CODES = new Set(["100", "131052", "131053"]);

/**
 * Download one inbound file: resolve the media id to Meta's short-lived URL,
 * then fetch the bytes with the same token. Both in one call because the URL
 * expires after five minutes.
 */
export function createCloudApiMediaPort(
  config: WhatsAppConfig,
  fetchImpl: Fetch = fetch,
): WhatsAppMediaPort | null {
  if (!config.enabled || !config.accessToken) return null;
  return async (providerMediaId, options) => {
    let meta: Json;
    try {
      meta = await graph(
        config,
        {
          method: "GET",
          path: encodeURIComponent(providerMediaId),
          what: "a media lookup",
        },
        fetchImpl,
      );
    } catch (error) {
      const sendError = error instanceof WhatsAppSendError ? error : null;
      const gone =
        sendError?.outcome === "not_sent"
        && !sendError.details.unreachable
        && MEDIA_GONE_CODES.has(sendError.details.code ?? "");
      throw new WhatsAppMediaError(
        gone
          ? "WhatsApp no longer has this file — it keeps media for 30 days."
          : (sendError?.message
              ?? "WhatsApp couldn't be reached for this file."),
        gone,
        sendError?.details.code,
      );
    }

    const url = stringOrNull(meta.url);
    const declaredSize =
      typeof meta.file_size === "number"
        ? meta.file_size
        : Number(meta.file_size ?? Number.NaN);
    if (!url) {
      throw new WhatsAppMediaError(
        "WhatsApp returned no download address for this file.",
        false,
      );
    }
    if (Number.isFinite(declaredSize) && declaredSize > options.maxBytes) {
      throw new WhatsAppMediaError(
        `This file is ${Math.ceil(declaredSize / 1_048_576)} MB, larger than the ${Math.floor(options.maxBytes / 1_048_576)} MB the app keeps. Open it in WhatsApp on the business phone.`,
        true,
        "too_large",
      );
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
    } catch (error) {
      console.warn(
        `[whatsapp] Media download failed (${causeCode(error) ?? (error as Error)?.name ?? "error"}).`,
      );
      throw new WhatsAppMediaError(
        "The file couldn't be downloaded from WhatsApp.",
        false,
      );
    }
    if (!response.ok) {
      console.warn(
        `[whatsapp] Media download answered HTTP ${response.status}.`,
      );
      throw new WhatsAppMediaError(
        "The file couldn't be downloaded from WhatsApp.",
        response.status === 404 || response.status === 410,
        String(response.status),
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > options.maxBytes) {
      throw new WhatsAppMediaError(
        `This file is larger than the ${Math.floor(options.maxBytes / 1_048_576)} MB the app keeps. Open it in WhatsApp on the business phone.`,
        true,
        "too_large",
      );
    }
    if (
      Number.isFinite(declaredSize)
      && declaredSize > 0
      && bytes.byteLength !== declaredSize
    ) {
      // Truncated in transit. Worth another attempt.
      throw new WhatsAppMediaError(
        "The file arrived incomplete from WhatsApp.",
        false,
      );
    }
    return {
      byteSize: bytes.byteLength,
      bytes,
      mimeType:
        stringOrNull(meta.mime_type)
        ?? stringOrNull(response.headers.get("content-type")),
    };
  };
}

export function createWhatsAppMediaPortFromEnv(
  env: Record<string, string | undefined> = process.env,
): WhatsAppMediaPort | null {
  return createCloudApiMediaPort(readWhatsAppConfig(env));
}
