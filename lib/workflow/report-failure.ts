import { errorStatus } from "@/lib/observability/filter";
import { reportError } from "@/lib/observability/report-error";

// A workflow run that ends in failure, reported once.
//
// A workflow body runs in a sandbox that replays it and cannot load Sentry, so
// it cannot report an error itself; only a step can. And a step is retried
// (three more attempts by default) before the run is given up on, so reporting
// from inside a step would email about every transient blip. Reporting from the
// workflow's own `catch` — after the steps have run out of retries — is
// reporting the incident, not the attempts.
//
// What this does NOT cover: a failure the workflow body catches and carries on
// from ("out of retries, the rest of the files still get their turn"). Those
// log with `console.error`, the sandbox shares the host's console, and console
// capture picks them up.

export interface WorkflowFailure {
  name: string;
  message: string;
  stack?: string;
  status?: number;
}

// A step failure arrives in the workflow body rebuilt from its serialised form,
// so the `DomainError` class is gone and `instanceof` no longer answers. The
// `name` survives, and these are the refusals, not faults.
const REFUSAL_NAMES = new Set([
  "DomainValidationError",
  "DomainAuthorizationError",
  "DomainNotFoundError",
  "DomainStaleVersionError",
  "DomainTransitionError",
]);

/**
 * What to hand the reporting step, or `null` when the failure is not worth an
 * email: a refusal, or a run someone cancelled. Pure, so it is safe inside the
 * workflow sandbox.
 */
export function describeFailure(error: unknown): WorkflowFailure | null {
  const name =
    typeof error === "object"
    && error !== null
    && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "Error";
  if (REFUSAL_NAMES.has(name) || /cancel/i.test(name)) return null;

  const message =
    typeof error === "object"
    && error !== null
    && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : String(error);
  const stack =
    typeof error === "object"
    && error !== null
    && typeof (error as { stack?: unknown }).stack === "string"
      ? (error as { stack: string }).stack
      : undefined;
  const status = errorStatus(error);
  return {
    name,
    message,
    ...(stack ? { stack } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

/**
 * The step that sends the report. Never retried: `reportError` does not throw,
 * and a retry loop around a reporter is how a quota is spent.
 */
export async function reportWorkflowFailure(
  workflow: string,
  failure: WorkflowFailure,
): Promise<void> {
  "use step";
  const error = new Error(failure.message);
  error.name = failure.name;
  if (failure.stack) error.stack = failure.stack;
  if (failure.status !== undefined) {
    Object.assign(error, { status: failure.status });
  }
  reportError(error, {
    source: `workflow:${workflow}`,
    tags: { workflow },
    // One issue per workflow and failure type, not one per input message.
    fingerprint: ["workflow", workflow, failure.name],
  });
}
reportWorkflowFailure.maxRetries = 0;

/**
 * Called from a workflow's `catch`, then the workflow rethrows:
 *
 * ```ts
 * } catch (error) {
 *   await reportWorkflowError("syncSentMail", error);
 *   throw error;
 * }
 * ```
 *
 * A plain function, not a step: it runs in the sandbox and calls one.
 */
export async function reportWorkflowError(
  workflow: string,
  error: unknown,
): Promise<void> {
  const failure = describeFailure(error);
  if (failure) await reportWorkflowFailure(workflow, failure);
}
