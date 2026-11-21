import {
  WhatsAppBridgeError,
  type WhatsAppBridgeGroup,
  type WhatsAppBridgePort,
  type WhatsAppBridgeSession,
} from "@/lib/domain/ports/whatsapp-bridge";
import {
  WhatsAppMediaError,
  WhatsAppSendError,
  type WhatsAppMediaPort,
} from "@/lib/domain/ports/whatsapp";
import { reportExternalError } from "@/lib/observability/external";

import { readWhatsAppBridgeConfig, type WhatsAppBridgeConfig } from "./config";

// The WhatsApp bridge's HTTP API, as a port (lib/domain/ports/whatsapp-bridge).
// Plain `fetch`, Node-safe, used by the App and by Eve. The routes and their
// error codes are in docs/whatsapp-bridge.md.
//
// The judgement this adapter owns is whether a failed send may have reached
// the group. The bridge says so in its error code; a request that never got
// an answer (timeout, dropped connection) is treated as "may have", because a
// second copy of a message on a client's phone is the expensive mistake.

type Fetch = typeof fetch;

const DEFAULT_TIMEOUT_MS = 20_000;
const CREATE_TIMEOUT_MS = 45_000;
const SEND_TIMEOUT_MS = 30_000;
const MEDIA_TIMEOUT_MS = 60_000;

/** Bridge codes that mean nothing was sent. Everything else might have been. */
const NOT_SENT_CODES = new Set([
  "bad_request",
  "not_connected",
  "not_found",
  "not_admin",
  "whatsapp_refused",
  "in_progress",
  "unauthorized",
]);

type ErrorBody = { error?: { code?: string; message?: string } };

const UNREACHABLE =
  "The WhatsApp bridge couldn't be reached. Check that its server is running (Admin › WhatsApp bridge).";

function groupFrom(raw: Record<string, unknown>): WhatsAppBridgeGroup {
  const participants = Array.isArray(raw.participants)
    ? (raw.participants as Record<string, unknown>[])
    : [];
  return {
    createdAt:
      typeof raw.createdAt === "string" ? new Date(raw.createdAt) : null,
    description: typeof raw.description === "string" ? raw.description : null,
    isAdmin: raw.isAdmin === true,
    jid: String(raw.jid ?? ""),
    mappedProjectId:
      typeof raw.projectId === "string" && raw.projectId ? raw.projectId : null,
    participants: participants.map((participant) => ({
      admin:
        participant.admin === "admin" || participant.admin === "superadmin"
          ? participant.admin
          : null,
      jid: String(participant.jid ?? ""),
      phoneE164:
        typeof participant.phoneE164 === "string"
          ? participant.phoneE164
          : null,
    })),
    subject: typeof raw.subject === "string" ? raw.subject : "",
  };
}

export function createWhatsAppBridgePort(
  config: WhatsAppBridgeConfig,
  fetchImpl: Fetch = fetch,
): WhatsAppBridgePort | null {
  if (!config.enabled || !config.url || !config.apiToken) return null;
  const base = config.url;
  const token = config.apiToken;

  async function call(
    operation: string,
    path: string,
    init: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
      /** Statuses answered with null instead of thrown. */
      allow?: readonly number[];
    } = {},
  ): Promise<{ status: number; body: unknown; response: Response } | null> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...init.headers,
        },
        method: init.method ?? "GET",
        signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      const error = new WhatsAppBridgeError(UNREACHABLE, "unreachable");
      reportExternalError("whatsapp-bridge", operation, error, {
        extra: { cause: (cause as Error)?.name ?? "error" },
      });
      throw error;
    }
    if (init.allow?.includes(response.status)) return null;
    if (response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      return { body, response, status: response.status };
    }
    const parsed = (await response
      .json()
      .catch(() => null)) as ErrorBody | null;
    const code = parsed?.error?.code ?? `http_${response.status}`;
    const message =
      response.status === 401
        ? "The app's WHATSAPP_BRIDGE_API_TOKEN doesn't match the bridge's BRIDGE_API_TOKEN."
        : (parsed?.error?.message
          ?? `The WhatsApp bridge answered ${response.status}.`);
    const error = new WhatsAppBridgeError(message, code, response.status);
    // A logged-out session is announced once by the bridge's session event;
    // reporting every refused call as well would bury it.
    if (code !== "not_connected") {
      reportExternalError("whatsapp-bridge", operation, error);
    }
    throw error;
  }

  async function json<T>(
    operation: string,
    path: string,
    init?: Parameters<typeof call>[2],
  ): Promise<T> {
    const result = await call(operation, path, init);
    return (result?.body ?? {}) as T;
  }

  const sessionCall = (operation: string, path: string, method = "GET") =>
    json<WhatsAppBridgeSession>(operation, path, { method });

  const downloadMedia: WhatsAppMediaPort = async (messageId, options) => {
    let response: Response | null = null;
    try {
      const result = await call(
        "media",
        `/v1/media/${encodeURIComponent(messageId)}`,
        { allow: [404], timeoutMs: MEDIA_TIMEOUT_MS },
      );
      response = result?.response ?? null;
    } catch (error) {
      throw new WhatsAppMediaError(
        error instanceof WhatsAppBridgeError
          ? error.message
          : "The WhatsApp bridge couldn't be reached for this file.",
        false,
        error instanceof WhatsAppBridgeError ? error.code : undefined,
      );
    }
    if (!response) {
      throw new WhatsAppMediaError(
        "The WhatsApp bridge no longer has this file. Open it in the group on the business phone.",
        true,
        "gone",
      );
    }
    const declared = Number(response.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new WhatsAppMediaError(
        `This file is ${Math.ceil(declared / 1_048_576)} MB, larger than the ${Math.floor(options.maxBytes / 1_048_576)} MB the app keeps.`,
        true,
        "too_large",
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > options.maxBytes) {
      throw new WhatsAppMediaError(
        "This file is larger than the app keeps.",
        true,
        "too_large",
      );
    }
    return {
      byteSize: bytes.byteLength,
      bytes,
      mimeType: response.headers.get("content-type"),
    };
  };

  return {
    connect: () => sessionCall("connect", "/v1/session/connect", "POST"),

    createGroup: async (request) => {
      let body: { group?: Record<string, unknown>; inviteLink?: unknown };
      try {
        body = await json("createGroup", "/v1/groups", {
          body: {
            description: request.description ?? undefined,
            participants: request.participantsE164,
            projectId: request.projectId ?? undefined,
            subject: request.subject,
          },
          method: "POST",
          timeoutMs: CREATE_TIMEOUT_MS,
        });
      } catch (error) {
        if (error instanceof WhatsAppBridgeError) {
          throw new WhatsAppSendError(
            error.message,
            NOT_SENT_CODES.has(error.code) ? "not_sent" : "ambiguous",
            {
              code: error.code,
              unreachable: error.code === "unreachable",
            },
          );
        }
        throw error;
      }
      return {
        group: groupFrom(body.group ?? {}),
        inviteLink:
          typeof body.inviteLink === "string" ? body.inviteLink : null,
      };
    },

    downloadMedia,

    group: async (groupJid) => {
      const body = await json<{ group?: Record<string, unknown> }>(
        "group",
        `/v1/groups/${encodeURIComponent(groupJid)}`,
      );
      return groupFrom(body.group ?? {});
    },

    inviteLink: async (groupJid) => {
      const body = await json<{ inviteLink?: unknown }>(
        "inviteLink",
        `/v1/groups/${encodeURIComponent(groupJid)}/invite`,
      );
      if (typeof body.inviteLink !== "string" || !body.inviteLink) {
        throw new WhatsAppBridgeError(
          "The WhatsApp bridge returned no invite link.",
          "whatsapp_refused",
        );
      }
      return body.inviteLink;
    },

    listGroups: async () => {
      const body = await json<{ groups?: Record<string, unknown>[] }>(
        "listGroups",
        "/v1/groups",
      );
      return (body.groups ?? []).map(groupFrom);
    },

    logout: () => sessionCall("logout", "/v1/session/logout", "POST"),

    qr: async () => {
      const result = await call("qr", "/v1/session/qr", { allow: [404] });
      if (!result) return null;
      const body = result.body as { dataUrl?: unknown; issuedAt?: unknown };
      return typeof body?.dataUrl === "string"
        ? {
            dataUrl: body.dataUrl,
            issuedAt: typeof body.issuedAt === "string" ? body.issuedAt : null,
          }
        : null;
    },

    removeMapping: async (groupJid) => {
      await call(
        "removeMapping",
        `/v1/mappings/${encodeURIComponent(groupJid)}`,
        {
          method: "DELETE",
        },
      );
    },

    replaceMappings: (mappings) =>
      json("replaceMappings", "/v1/mappings", {
        body: { mappings },
        method: "PUT",
      }),

    sendText: async (message) => {
      let body: { messageId?: unknown; sentAt?: unknown; replayed?: unknown };
      try {
        body = await json(
          "sendText",
          `/v1/groups/${encodeURIComponent(message.groupJid)}/messages`,
          {
            body: { text: message.text },
            headers: { "Idempotency-Key": message.idempotencyKey },
            method: "POST",
            timeoutMs: SEND_TIMEOUT_MS,
          },
        );
      } catch (error) {
        if (error instanceof WhatsAppBridgeError) {
          throw new WhatsAppSendError(
            error.message,
            NOT_SENT_CODES.has(error.code) ? "not_sent" : "ambiguous",
            {
              code: error.code,
              unreachable: error.code === "unreachable",
            },
          );
        }
        throw error;
      }
      if (typeof body.messageId !== "string" || !body.messageId) {
        throw new WhatsAppSendError(
          "The WhatsApp bridge accepted the message but returned no id.",
          "ambiguous",
        );
      }
      return {
        messageId: body.messageId,
        replayed: body.replayed === true,
        sentAt:
          typeof body.sentAt === "string" ? new Date(body.sentAt) : new Date(),
      };
    },

    session: () => sessionCall("session", "/v1/session"),

    setMapping: async (groupJid, projectId) => {
      await call("setMapping", `/v1/mappings/${encodeURIComponent(groupJid)}`, {
        body: { projectId },
        method: "PUT",
      });
    },
  };
}

/** The bridge port for this runtime, or null when the bridge isn't configured. */
export function createWhatsAppBridgePortFromEnv(
  env: Record<string, string | undefined> = process.env,
): WhatsAppBridgePort | null {
  return createWhatsAppBridgePort(readWhatsAppBridgeConfig(env));
}
