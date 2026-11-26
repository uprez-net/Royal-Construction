import type {
  OwnerAssistantPort,
  OwnerAssistantQuestion,
} from "@/lib/domain/ports/owner-assistant";
import { reportExternalError } from "@/lib/observability/external";

import type { HermesConfig } from "./config";

// Mili → Hermes: one question to Hermes's MCP server, over Streamable HTTP.
//
// Deliberately small rather than a full MCP client: three requests (initialize,
// the initialized notification, one tools/call), a bearer token, and either a
// JSON or a text/event-stream answer. Hermes's server is long-lived and needs
// none of the rest. A failure is reported once here, as `hermes`, and thrown;
// the domain turns it into "Mili couldn't check that just now".

const PROTOCOL_VERSION = "2025-06-18";

/** The whole exchange; the voice session gives up on its own just after. */
const ASK_TIMEOUT_MS = 22_000;

export class HermesError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HermesError";
    this.status = status;
  }
}

type JsonRpcResponse = {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
};

/** The response to request `id`, from a JSON body or an SSE stream. */
export async function readRpcResponse(
  response: Response,
  id: number,
): Promise<JsonRpcResponse> {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const candidates: unknown[] = [];
  if (type.includes("text/event-stream")) {
    // Events are separated by a blank line; a data field may span lines.
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        candidates.push(JSON.parse(data));
      } catch {
        // Not JSON-RPC (a keep-alive comment, say): skip it.
      }
    }
  } else {
    try {
      const parsed: unknown = JSON.parse(text);
      candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      throw new HermesError("Hermes answered with something that is not JSON.");
    }
  }
  const match = candidates.find(
    (candidate): candidate is JsonRpcResponse =>
      typeof candidate === "object"
      && candidate !== null
      && (candidate as { id?: unknown }).id === id,
  );
  if (!match) throw new HermesError("Hermes did not answer the request.");
  return match;
}

/** The text of a tools/call result, or a throw for an error result. */
export function toolResultText(result: unknown): string {
  const r = (result ?? {}) as {
    content?: unknown;
    isError?: unknown;
    structuredContent?: unknown;
  };
  const texts = Array.isArray(r.content)
    ? r.content
        .filter(
          (part): part is { type: "text"; text: string } =>
            typeof part === "object"
            && part !== null
            && (part as { type?: unknown }).type === "text"
            && typeof (part as { text?: unknown }).text === "string",
        )
        .map((part) => part.text)
    : [];
  const text = texts.join("\n").trim();
  if (r.isError === true) {
    // The tool's own refusal: Hermes answered, it just could not help. Not an
    // outage, so it carries a 4xx and is not reported as one.
    throw new HermesError(`Hermes's tool refused: ${text.slice(0, 200)}`, 422);
  }
  if (!text && r.structuredContent !== undefined) {
    return JSON.stringify(r.structuredContent);
  }
  return text;
}

export function hermesAssistant(
  config: HermesConfig,
  fetcher: typeof fetch = fetch,
): OwnerAssistantPort | null {
  const server = config.server;
  if (!server) return null;

  const post = async (
    body: Record<string, unknown>,
    session: string | null,
    signal: AbortSignal,
  ): Promise<Response> => {
    const response = await fetcher(server.url, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${server.token}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        ...(session ? { "Mcp-Session-Id": session } : {}),
      },
      method: "POST",
      signal,
    });
    if (!response.ok && response.status !== 202) {
      throw new HermesError(
        `Hermes answered ${response.status} to ${String(body.method)}.`,
        response.status,
      );
    }
    return response;
  };

  const ask = async (request: OwnerAssistantQuestion): Promise<string> => {
    const signal = AbortSignal.timeout(ASK_TIMEOUT_MS);
    const init = await post(
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "royal-constructions-mili", version: "1.0.0" },
          protocolVersion: PROTOCOL_VERSION,
        },
      },
      null,
      signal,
    );
    const session = init.headers.get("mcp-session-id");
    const initialized = await readRpcResponse(init, 1);
    if (initialized.error) {
      throw new HermesError("Hermes refused to start an MCP session.");
    }
    await post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      session,
      signal,
    );
    const call = await post(
      {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {
            call_id: request.callId,
            context: request.context,
            question: request.question,
            ...(request.reference ? { reference: request.reference } : {}),
          },
          name: server.askTool,
        },
      },
      session,
      signal,
    );
    const answer = await readRpcResponse(call, 2);
    if (answer.error) {
      throw new HermesError(
        `Hermes's ${server.askTool} failed: ${String(answer.error.message ?? "no message").slice(0, 200)}`,
      );
    }
    return toolResultText(answer.result);
  };

  return {
    ask: async (request) => {
      try {
        return await ask(request);
      } catch (error) {
        reportExternalError("hermes", "ask", error, {
          ids: { callId: request.callId },
        });
        throw error;
      }
    },
  };
}
