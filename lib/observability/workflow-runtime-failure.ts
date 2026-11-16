// What the Workflow runtime says when a run reaches a terminal failure.
//
// `@workflow/core` logs `console.error("[Workflow] Error while running
// workflow", { workflowRunId, errorCode, errorName, errorStack })`. Console
// capture joins the arguments into the event message, so the object becomes
// "[object Object]", and `beforeSend` then deletes the raw arguments (they are
// whatever was in scope at the call, and not text the redactor can walk). The
// result was an issue that said a run failed and nothing else: not why, not
// which kind, not which run.
//
// This reads back only three fields, each validated against a strict shape so
// nothing else can ride along. It deliberately does NOT read `errorStack`: its
// first line is the error's message, which can carry an address or a phone
// number.
//
// Pure: no Sentry, no Next.

const RUNTIME_FAILURE_MESSAGE = "[Workflow] Error while running workflow";

export interface WorkflowRuntimeFailure {
  /** The runtime's own classification, e.g. `USER_ERROR`, `RUNTIME_ERROR`. */
  code: string;
  /** The error's class name, e.g. `FatalError`. */
  name: string;
  /** The run, so it can be looked up; an id, never contents. */
  runId: string | null;
}

function pick(value: unknown, shape: RegExp): string | null {
  return typeof value === "string" && shape.test(value) ? value : null;
}

/**
 * The classification of a runtime failure line, or `null` when this is not one
 * (or its metadata is not in the shape this expects, in which case the event is
 * left exactly as it was).
 */
export function workflowRuntimeFailure(
  message: string | undefined,
  consoleArguments: unknown,
): WorkflowRuntimeFailure | null {
  if (!message?.startsWith(RUNTIME_FAILURE_MESSAGE)) return null;
  if (!Array.isArray(consoleArguments)) return null;
  const metadata = consoleArguments.find(
    (argument): argument is Record<string, unknown> =>
      typeof argument === "object" && argument !== null,
  );
  const code = pick(metadata?.errorCode, /^[A-Z][A-Z0-9_]{2,39}$/);
  if (!code) return null;
  return {
    code,
    name: pick(metadata?.errorName, /^[A-Za-z][A-Za-z0-9_.]{0,59}$/) ?? "Error",
    runId: pick(metadata?.workflowRunId, /^wrun_[0-9A-Za-z]{10,40}$/),
  };
}
