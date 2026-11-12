import { getVercelOidcToken } from "@vercel/functions/oidc";
import { WebSocket } from "ws";

import { VOICE_AGENT_MODEL } from "./settings";

// One GPT-Live session on AI Gateway, for one call.
//
// GPT-Live is not the realtime API: it has its own socket
// (wss://ai-gateway.vercel.sh/v1/live/sessions) and its own events
// (session.start, session.input_audio.append, session.output_audio.delta,
// transcript deltas, client delegation, context appends). AI Gateway is the
// only provider: the socket opens with a single-use Live client secret the
// server mints with its own Gateway credential — AI_GATEWAY_API_KEY, or the
// deployment's Vercel OIDC token, the same order the Gateway provider uses —
// so that credential never travels on the socket itself.
//
// Shapes are from the Gateway's GPT-Live guide and @ai-sdk/openai's Live
// codec, and were checked against the live service on 2026-11-12.

const GATEWAY_ORIGIN = "https://ai-gateway.vercel.sh";
const LIVE_SOCKET_URL = "wss://ai-gateway.vercel.sh/v1/live/sessions";
const MINT_TIMEOUT_MS = 8_000;

/** What the relay sends to GPT-Live. */
export type LiveClientEvent =
  | {
      readonly type: "session.start";
      readonly session: {
        readonly model: string;
        readonly instructions: string;
        readonly audio: {
          readonly format: { readonly type: "audio/pcmu"; readonly rate: 8000 };
          readonly output: { readonly voice: string };
        };
        readonly delegation: { readonly type: "client" };
        readonly store: false;
      };
    }
  | { readonly type: "session.input_audio.append"; readonly audio: string }
  | {
      readonly type:
        | "session.instructions.append"
        | "session.thinking.append"
        | "session.commentary.append";
      readonly content: string;
      readonly delegation_id: string | null;
    }
  | { readonly type: "session.close" };

/** What the relay acts on from GPT-Live; everything else is "other". */
export type LiveServerEvent =
  | { readonly type: "session.started" }
  | { readonly type: "session.closed"; readonly reason: string | null }
  | { readonly type: "session.output_audio.delta"; readonly delta: string }
  | {
      readonly type:
        | "session.input_transcript.delta"
        | "session.output_transcript.delta";
      readonly delta: string;
      /** Session time, in ms, the words were spoken; null if not given. */
      readonly startMs: number | null;
      readonly endMs: number | null;
    }
  | {
      readonly type: "session.delegation.created";
      readonly delegationId: string;
    }
  | {
      readonly type: "error";
      readonly code: string | null;
      readonly message: string;
    }
  | { readonly type: "other" };

export type LiveConnection = {
  send(event: LiveClientEvent): void;
  close(): void;
};

type Json = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function ms(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** One server frame, narrowed to what the relay uses. */
export function parseLiveServerEvent(raw: string): LiveServerEvent {
  let event: Json;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { type: "other" };
    event = parsed as Json;
  } catch {
    return { type: "other" };
  }
  switch (event.type) {
    case "session.started":
      return { type: "session.started" };
    case "session.closed":
      return { reason: text(event.reason), type: "session.closed" };
    case "session.output_audio.delta": {
      const delta = text(event.delta);
      return delta === null ? { type: "other" } : { delta, type: event.type };
    }
    case "session.input_transcript.delta":
    case "session.output_transcript.delta": {
      const delta = text(event.delta);
      return delta === null
        ? { type: "other" }
        : {
            delta,
            endMs: ms(event.end_ms),
            startMs: ms(event.start_ms),
            type: event.type,
          };
    }
    case "session.delegation.created": {
      const id = text((event.delegation as Json | undefined)?.id);
      return id
        ? { delegationId: id, type: "session.delegation.created" }
        : { type: "other" };
    }
    case "error": {
      const error = (event.error ?? {}) as Json;
      return {
        code: text(error.code),
        message: text(error.message) ?? "GPT-Live reported an error.",
        type: "error",
      };
    }
    default:
      return { type: "other" };
  }
}

export type LiveDeps = {
  readonly env?: Record<string, string | undefined>;
  readonly fetch?: typeof fetch;
  readonly oidcToken?: () => Promise<string>;
};

/** The server's Gateway credential, as the Gateway provider resolves it. */
async function gatewayCredential(
  deps: LiveDeps,
): Promise<{ token: string; method: "api-key" | "oidc" }> {
  const apiKey = (deps.env ?? process.env).AI_GATEWAY_API_KEY?.trim();
  if (apiKey) return { method: "api-key", token: apiKey };
  return {
    method: "oidc",
    token: await (deps.oidcToken ?? getVercelOidcToken)(),
  };
}

/** A single-use client secret bound to GPT-Live and the Live route. */
export async function mintLiveClientSecret(
  deps: LiveDeps = {},
): Promise<string> {
  const credential = await gatewayCredential(deps);
  const response = await (deps.fetch ?? fetch)(
    `${GATEWAY_ORIGIN}/v1/realtime/client-secrets`,
    {
      body: JSON.stringify({ model: VOICE_AGENT_MODEL, routeKind: "live" }),
      headers: {
        "ai-gateway-auth-method": credential.method,
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(
      `AI Gateway refused a GPT-Live session (HTTP ${response.status}).`,
    );
  }
  const body = (await response.json().catch(() => null)) as Json | null;
  const token = text(body?.token);
  if (!token) throw new Error("AI Gateway returned no GPT-Live token.");
  return token;
}

/** Open the Live socket; frames come back through `onEvent`. */
export async function openLiveSession(
  onEvent: (event: LiveServerEvent) => void,
  onClose: () => void,
  log: Pick<Console, "warn"> = console,
  deps: LiveDeps = {},
): Promise<LiveConnection> {
  const token = await mintLiveClientSecret(deps);
  const socket = new WebSocket(LIVE_SOCKET_URL, [
    "ai-gateway-realtime.v1",
    `ai-gateway-auth.${token}`,
  ]);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  socket.on("error", (error) =>
    log.warn("[voice-agent] GPT-Live socket error:", error.message),
  );
  socket.on("message", (data) =>
    onEvent(parseLiveServerEvent(data.toString())),
  );
  socket.on("close", onClose);
  return {
    close: () => socket.close(),
    send: (event) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    },
  };
}
