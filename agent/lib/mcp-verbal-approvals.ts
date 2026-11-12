import { APPROVAL_TARGET_FIELDS } from "@/lib/domain/agent/approval-targets";
import {
  describeApprovalPrompt,
  hasWordsOnlyResponse,
  interpretVerbalResponses,
  type InputResponse,
  type PendingInputRequest,
} from "@/agent/lib/verbal-approval";

// Verbal approvals over MCP, as a wrapper around eve's own MCP route.
//
// eve's MCP channel is closed: four tools, its own schemas, its own approval
// resolution. Two things in it work against a person talking to a hosted
// client, and both are fixed here at the HTTP boundary rather than by a fork:
//
// 1. An `agent_update` that answers an approval with words ("yes go ahead")
//    and no option id is read by eve as an invalid answer, which denies the
//    action. The wrapper reads the pending requests, turns a clear yes/no into
//    the option id, and refuses an unclear answer with a message telling the
//    client to ask again — nothing is approved or denied on a guess.
// 2. The approval prompt eve produces is "Approve tool call: update_lead",
//    with raw ids. The wrapper rewrites it to name the records and the change
//    (agent/lib/verbal-approval.ts), so what the person hears is what they
//    are approving.
//
// Everything else — auth, ownership, the approval response policy that only
// lets the session owner approve — is still eve's, and runs unchanged on the
// request this forwards.

type RouteHandler = (request: Request, ctx: unknown) => Promise<Response>;
type HttpRoute = {
  transport?: string;
  method: string;
  path: string;
  handler: RouteHandler;
};

export type VerbalApprovalDeps = {
  /** Names for the ids in a tool input, under the caller's own access rules. */
  readonly describeTargets: (
    request: Request,
    input: Record<string, unknown>,
  ) => Promise<Readonly<Record<string, string>>>;
};

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    _meta?: unknown;
  };
  result?: {
    content?: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
};

const ENRICHED_TOOLS = new Set(["agent_start", "agent_get", "agent_update"]);

/** Wrap the POST route of an mcpChannel definition. Other routes are untouched. */
export function withVerbalApprovals<T extends { routes: readonly unknown[] }>(
  channel: T,
  route: string,
  deps: VerbalApprovalDeps,
): T {
  return {
    ...channel,
    routes: (channel.routes as readonly HttpRoute[]).map((entry) =>
      entry.method === "POST" && entry.path === route
        ? { ...entry, handler: verbalApprovalHandler(entry.handler, deps) }
        : entry,
    ),
  };
}

export function verbalApprovalHandler(
  inner: RouteHandler,
  deps: VerbalApprovalDeps,
): RouteHandler {
  return async (request, ctx) => {
    const body = await request.text();
    const message = parseJson(body) as JsonRpcMessage | undefined;
    const toolName =
      message?.method === "tools/call" ? message.params?.name : undefined;
    if (!message || !toolName) return inner(withBody(request, body), ctx);

    let forwarded = body;
    const args = message.params?.arguments;
    const responses = args?.responses;
    if (
      toolName === "agent_update"
      && typeof args?.invocationId === "string"
      && Array.isArray(responses)
      && hasWordsOnlyResponse(responses as InputResponse[])
    ) {
      const pending = await readPendingRequests(
        inner,
        request,
        ctx,
        args.invocationId,
        message.params?._meta,
      );
      // Without the pending requests the words cannot be read, and eve would
      // deny an approval answered in words. Refuse instead of forwarding.
      if (!pending) return lookupFailedResponse(message.id ?? null);
      const { responses: interpreted, unclear } = interpretVerbalResponses(
        responses as InputResponse[],
        pending,
      );
      if (unclear.length)
        return unclearAnswerResponse(message.id ?? null, unclear);
      forwarded = JSON.stringify({
        ...message,
        params: {
          ...message.params,
          arguments: { ...args, responses: interpreted },
        },
      });
    }

    const response = await inner(withBody(request, forwarded), ctx);
    if (!ENRICHED_TOOLS.has(toolName)) return response;
    return enrichApprovalPrompts(response, request, deps);
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The same request with a new body; the stale content-length goes. */
function withBody(request: Request, body: string): Request {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { body, headers, method: request.method });
}

/**
 * Read the invocation's pending requests through eve itself, as the caller.
 * Null when the read failed or the invocation is not waiting on input.
 */
async function readPendingRequests(
  inner: RouteHandler,
  request: Request,
  ctx: unknown,
  invocationId: string,
  meta: unknown,
): Promise<Record<string, PendingInputRequest> | null> {
  const lookup = {
    id: "verbal-approval-lookup",
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      arguments: { invocationId },
      name: "agent_get",
      ...(meta === undefined ? {} : { _meta: meta }),
    },
  };
  let parsed: ParsedResponse | null;
  try {
    const response = await inner(
      withBody(request, JSON.stringify(lookup)),
      ctx,
    );
    parsed = await readJsonRpc(response);
  } catch (error) {
    console.error(
      "[mcp-verbal-approvals] pending-request lookup failed",
      error,
    );
    return null;
  }
  const result = parsed?.message.result;
  const requests = result?.structuredContent?.inputRequests;
  if (result?.isError || !requests || typeof requests !== "object") {
    if (result?.isError || !parsed) {
      console.error(
        "[mcp-verbal-approvals] pending-request lookup refused",
        result?.structuredContent?.error ?? "unreadable response",
      );
    }
    return null;
  }
  return requests as Record<string, PendingInputRequest>;
}

type ParsedResponse = {
  message: JsonRpcMessage;
  /** For an SSE body: every event, and which one carried the message. */
  events?: string[];
  eventIndex?: number;
};

/** The JSON-RPC result in a JSON or SSE response body. */
export async function readJsonRpc(
  response: Response,
): Promise<ParsedResponse | null> {
  const text = await response.text();
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    const message = parseJson(text) as JsonRpcMessage | undefined;
    return message && typeof message === "object" ? { message } : null;
  }
  const events = text.split(/\r?\n\r?\n/);
  for (const [index, event] of events.entries()) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    const message = parseJson(data) as JsonRpcMessage | undefined;
    if (
      message
      && typeof message === "object"
      && ("result" in message || "error" in message)
    ) {
      return { eventIndex: index, events, message };
    }
  }
  return null;
}

function rebuildResponse(original: Response, parsed: ParsedResponse): Response {
  const headers = new Headers(original.headers);
  headers.delete("content-length");
  let body: string;
  if (parsed.events && parsed.eventIndex !== undefined) {
    const events = [...parsed.events];
    const lines = (events[parsed.eventIndex] ?? "")
      .split(/\r?\n/)
      .filter((line) => !line.startsWith("data:"));
    events[parsed.eventIndex] = [
      ...lines,
      `data: ${JSON.stringify(parsed.message)}`,
    ].join("\n");
    body = events.join("\n\n");
  } else {
    body = JSON.stringify(parsed.message);
  }
  return new Response(body, {
    headers,
    status: original.status,
    statusText: original.statusText,
  });
}

/** Rewrite approval prompts on an input_required result to name the records. */
async function enrichApprovalPrompts(
  response: Response,
  request: Request,
  deps: VerbalApprovalDeps,
): Promise<Response> {
  const copy = response.clone();
  let parsed: ParsedResponse | null;
  try {
    parsed = await readJsonRpc(copy);
  } catch {
    return response;
  }
  const structured = parsed?.message.result?.structuredContent;
  const requests = structured?.inputRequests as
    | Record<string, PendingInputRequest>
    | undefined;
  if (!parsed || structured?.status !== "input_required" || !requests)
    return response;

  let changed = false;
  for (const pending of Object.values(requests)) {
    if (pending.kind !== "tool-approval" || !pending.action?.toolName) continue;
    const input = pending.action.input ?? {};
    // Every nameable record in the input must come back named. A lookup that
    // failed, or a record this caller may not see, leaves the prompt saying
    // so — never a prompt that reads as if it names what it changes.
    const nameable = APPROVAL_TARGET_FIELDS.filter(
      (field) => input[field] !== undefined && input[field] !== null,
    );
    let labels: Readonly<Record<string, string>> = {};
    let unresolved: string[];
    try {
      labels = await deps.describeTargets(request, input);
      unresolved = nameable.filter((field) => !labels[field]);
    } catch (error) {
      console.error(
        "[mcp-verbal-approvals] approval target lookup failed",
        pending.action.toolName,
        error,
      );
      unresolved = [...nameable];
    }
    pending.prompt = describeApprovalPrompt(
      pending.action.toolName,
      input,
      labels,
      unresolved,
    );
    changed = true;
  }
  if (!changed) return response;

  const result = parsed.message.result!;
  result.content = (result.content ?? []).map((part) =>
    part.type === "text" ? { ...part, text: JSON.stringify(structured) } : part,
  );
  return rebuildResponse(response, parsed);
}

function lookupFailedResponse(id: string | number | null): Response {
  const message =
    "Could not read the pending input on this invocation, so the answer was not passed on and nothing was approved or cancelled. Call agent_get, check the status is input_required, then answer again.";
  return Response.json({
    id,
    jsonrpc: "2.0",
    result: {
      content: [{ text: message, type: "text" }],
      isError: true,
      structuredContent: {
        error: { code: "conflict", message, retryable: true },
      },
    },
  });
}

function unclearAnswerResponse(
  id: string | number | null,
  unclear: readonly InputResponse[],
): Response {
  const quoted = unclear
    .map((r) => `"${(r.text ?? "").slice(0, 120)}"`)
    .join(", ");
  const message = `Could not tell whether ${quoted} approves or cancels the pending action, so nothing was approved or cancelled. Ask the person for a clear yes or no, then call agent_update again with optionId "approve" or "cancel" (or their plain yes/no as text).`;
  return Response.json({
    id,
    jsonrpc: "2.0",
    result: {
      content: [{ text: message, type: "text" }],
      isError: true,
      structuredContent: {
        error: { code: "invalid_input", message, retryable: false },
      },
    },
  });
}
