import type { EveEvalContext, EveEvalTurn } from "eve/evals";

/**
 * Tool calls made *inside* a specialist, recovered from the parent stream.
 *
 * This exists because of one detail of the orchestrator's shape. Every
 * business tool in this repo belongs to a subagent under
 * `agent/subagents/*\/tools`, so the orchestrator never calls one directly: it
 * delegates, and the specialist's own session is where `actions.requested` and
 * `action.result` are emitted. eve forwards those to the parent wrapped as
 * `subagent.event`, but `t.calledTool(...)` reads the runner's derived facts,
 * which only look at unwrapped top-level events and at approval requests. So
 * `t.calledTool("get_lead")` finds nothing even on a run where `get_lead`
 * plainly ran, and — far worse for this suite — `t.calledTool(write, { count:
 * 0 })` passes on a run that did write, because the completed call was inside
 * the child.
 *
 * Unwrapping one level of `subagent.event` (recursively, for a specialist that
 * delegates onward) gives the real picture. Everything in `evals/` that
 * reasons about tool execution goes through here rather than through
 * `t.calledTool`, so there is one answer to "did this tool run".
 */

export type ObservedToolCall = {
  readonly callId: string;
  readonly name: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly status: "pending" | "completed" | "failed" | "rejected";
  /** The specialist the call ran inside, or undefined for the orchestrator. */
  readonly subagent: string | undefined;
};

type UnknownEvent = { readonly type?: unknown; readonly data?: unknown };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function collect(
  events: readonly unknown[],
  subagent: string | undefined,
  into: Map<string, ObservedToolCall>,
): void {
  for (const raw of events) {
    const event = asRecord(raw) as UnknownEvent | undefined;
    if (!event) continue;
    const data = asRecord(event.data);
    if (!data) continue;

    switch (event.type) {
      case "subagent.event": {
        const child = data.event;
        const name =
          typeof data.subagentName === "string" ? data.subagentName : subagent;
        if (child !== undefined) collect([child], name, into);
        break;
      }
      case "actions.requested": {
        const actions = Array.isArray(data.actions) ? data.actions : [];
        for (const rawAction of actions) {
          const action = asRecord(rawAction);
          if (!action || action.kind !== "tool-call") continue;
          upsert(into, String(action.callId), {
            input: action.input,
            name: String(action.toolName),
            subagent,
          });
        }
        break;
      }
      case "input.requested": {
        // An approval request registers the pending call before it executes.
        // It is forwarded to the parent session even when the tool belongs to
        // a child, which is exactly what the approval cases assert on.
        const requests = Array.isArray(data.requests) ? data.requests : [];
        for (const rawRequest of requests) {
          const request = asRecord(rawRequest);
          const action = asRecord(request?.action);
          if (!action || action.kind !== "tool-call") continue;
          upsert(into, String(action.callId), {
            input: action.input,
            name: String(action.toolName),
            subagent,
          });
        }
        break;
      }
      case "action.result": {
        const result = asRecord(data.result);
        if (!result || result.kind !== "tool-result") break;
        const callId = String(result.callId);
        const existing = into.get(callId);
        into.set(callId, {
          callId,
          input: existing?.input,
          name: existing?.name ?? String(result.toolName),
          output: result.output,
          status: toStatus(data.status),
          subagent: existing?.subagent ?? subagent,
        });
        break;
      }
      default:
        break;
    }
  }
}

function upsert(
  into: Map<string, ObservedToolCall>,
  callId: string,
  fields: { name: string; input: unknown; subagent: string | undefined },
): void {
  const existing = into.get(callId);
  into.set(callId, {
    callId,
    input: fields.input,
    name: fields.name,
    output: existing?.output,
    status: existing?.status ?? "pending",
    subagent: fields.subagent,
  });
}

function toStatus(value: unknown): ObservedToolCall["status"] {
  return value === "completed" || value === "failed" || value === "rejected"
    ? value
    : "pending";
}

/** Every tool call observed in a scope, orchestrator and specialists alike. */
export function observedToolCalls(
  scope: EveEvalContext | EveEvalTurn,
): readonly ObservedToolCall[] {
  const into = new Map<string, ObservedToolCall>();
  collect(scope.events, undefined, into);
  return [...into.values()];
}

/** Completed calls to `name`, in observation order. */
export function completedCalls(
  scope: EveEvalContext | EveEvalTurn,
  name: string,
): readonly ObservedToolCall[] {
  return observedToolCalls(scope).filter(
    (call) => call.name === name && call.status === "completed",
  );
}

/** A readable list of what did run, for a failure message. */
export function describeCalls(scope: EveEvalContext | EveEvalTurn): string {
  const calls = observedToolCalls(scope);
  if (calls.length === 0) return "no tool calls";
  return calls.map((call) => `${call.name}(${call.status})`).join(", ");
}
