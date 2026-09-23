import type { EveEvalContext } from "eve/evals";

/**
 * Tool calls made *inside* a specialist, recovered from its own session.
 *
 * This exists because of one detail of the orchestrator's shape. Every
 * business tool in this repo belongs to a subagent under
 * `agent/subagents/*\/tools`, so the orchestrator never calls one directly: it
 * delegates through the root `delegate` workflow tool, and the specialist's own
 * session is where `actions.requested` and `action.result` are emitted. The
 * parent stream carries only `subagent.called` (naming the child session) and
 * `subagent.completed`, and `t.calledTool(...)` reads the runner's derived
 * facts from the parent. So `t.calledTool("get_lead")` finds nothing even on a
 * run where `get_lead` plainly ran, and — far worse for this suite —
 * `t.calledTool(write, { count: 0 })` passes on a run that did write, because
 * the completed call was inside the child.
 *
 * `observe` reads each child session's stream (recursively, for a specialist
 * that delegates onward) and still unwraps the older inline `subagent.event`
 * shape. Everything in `evals/` that reasons about tool execution goes through
 * here rather than through `t.calledTool`, so there is one answer to "did this
 * tool run".
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
  scope = "",
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
        if (child !== undefined)
          collect([child], name, into, `${scope}/${name}`);
        break;
      }
      case "actions.requested": {
        const actions = Array.isArray(data.actions) ? data.actions : [];
        for (const rawAction of actions) {
          const action = asRecord(rawAction);
          if (!action || action.kind !== "tool-call") continue;
          upsert(into, keyOf(scope, action.callId), {
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
          upsert(into, keyOf(scope, action.callId), {
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
        const key = keyOf(scope, result.callId);
        const existing = into.get(key);
        into.set(key, {
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

/**
 * Call ids are unique within one session, not across them, so a specialist's
 * first call and the orchestrator's first call can share one — as can two
 * delegations to the same specialist. `scope` is the child session id.
 */
function keyOf(scope: string, callId: unknown): string {
  return JSON.stringify([scope, String(callId)]);
}

function upsert(
  into: Map<string, ObservedToolCall>,
  key: string,
  fields: { name: string; input: unknown; subagent: string | undefined },
): void {
  const existing = into.get(key);
  const [, callId] = JSON.parse(key) as [string, string];
  into.set(key, {
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

/** Anything that carries a captured event stream: a session or one turn. */
export type EventScope = { readonly events: readonly unknown[] };

/**
 * Every tool call in a run, orchestrator and specialists alike, read once.
 *
 * Assertions take this snapshot rather than a live scope because building it
 * is asynchronous: see `observe`.
 */
export type Observation = { readonly calls: readonly ObservedToolCall[] };

/** A delegated specialist session named on a parent stream. */
type ChildSession = { readonly sessionId: string; readonly name: string };

function childSessions(events: readonly unknown[]): readonly ChildSession[] {
  const found: ChildSession[] = [];
  for (const raw of events) {
    const event = asRecord(raw) as UnknownEvent | undefined;
    if (event?.type !== "subagent.called") continue;
    const data = asRecord(event.data);
    if (typeof data?.childSessionId !== "string") continue;
    // A remote child's stream is behind its own deployment's auth; none of
    // the operations specialists are remote, so only local children are read.
    if (data.remote !== undefined) continue;
    found.push({
      name: typeof data.name === "string" ? data.name : "specialist",
      sessionId: data.childSessionId,
    });
  }
  return found;
}

/**
 * Read a session's durable stream from the start up to its current tail.
 *
 * A specialist reached through the root `delegate` workflow tool runs in its
 * own session and eve does not copy its steps onto the parent stream: the
 * parent sees only `subagent.called` (with `childSessionId`) and
 * `subagent.completed`. Every business tool runs in a specialist, so without
 * reading the child the whole suite would see no tool calls at all — and every
 * "this write never ran" gate would pass on a run that wrote.
 */
async function readSessionEvents(
  t: EveEvalContext,
  sessionId: string,
): Promise<readonly unknown[]> {
  const response = await t.target.fetch(
    `/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0&includeTailIndex=1`,
    { signal: t.signal },
  );
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not read specialist session ${sessionId}: HTTP ${response.status}.`,
    );
  }
  // A missing or malformed tail must not read as "no events": an empty child
  // stream makes every "this write never ran" gate pass on a run that wrote.
  const header = response.headers.get("x-eve-stream-tail-index");
  const tail = header === null || header.trim() === "" ? NaN : Number(header);
  if (!Number.isInteger(tail) || tail < -1) {
    await response.body.cancel().catch(() => undefined);
    throw new Error(
      `Specialist session ${sessionId} did not report a valid stream tail index (got ${JSON.stringify(header)}).`,
    );
  }
  const events: unknown[] = [];
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  try {
    while (events.length <= tail) {
      const { done, value } = await reader.read();
      if (done) {
        const last = buffered.trim();
        if (last) events.push(JSON.parse(last));
        break;
      }
      buffered += value;
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) events.push(JSON.parse(line));
        newline = buffered.indexOf("\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (events.length <= tail) {
    throw new Error(
      `Specialist session ${sessionId} stream ended after ${events.length} events; expected ${tail + 1}.`,
    );
  }
  return events;
}

/**
 * Snapshot every tool call in one or more sessions, including the calls each
 * delegated specialist made in its own session (and any specialist it
 * delegated to in turn).
 */
export async function observe(
  t: EveEvalContext,
  ...scopes: readonly EventScope[]
): Promise<Observation> {
  const into = new Map<string, ObservedToolCall>();
  const visited = new Set<string>();
  const pending: ChildSession[] = [];
  for (const scope of scopes) {
    collect(scope.events, undefined, into);
    pending.push(...childSessions(scope.events));
  }
  while (pending.length > 0) {
    const child = pending.shift() as ChildSession;
    if (visited.has(child.sessionId)) continue;
    visited.add(child.sessionId);
    const events = await readSessionEvents(t, child.sessionId);
    collect(events, child.name, into, child.sessionId);
    pending.push(...childSessions(events));
  }
  return { calls: [...into.values()] };
}

/** Completed calls to `name`, in observation order. */
export function completedCalls(
  run: Observation,
  name: string,
): readonly ObservedToolCall[] {
  return run.calls.filter(
    (call) => call.name === name && call.status === "completed",
  );
}

/** A readable list of what did run, for a failure message. */
export function describeCalls(run: Observation): string {
  if (run.calls.length === 0) return "no tool calls";
  return run.calls.map((call) => `${call.name}(${call.status})`).join(", ");
}
