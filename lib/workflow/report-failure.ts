import { redactText } from "@/lib/observability/redact";
import { reportError } from "@/lib/observability/report-error";
import { stackSaysReported } from "@/lib/observability/workflow-context";

// A workflow run that ends in failure, reported once.
//
// A workflow body runs in a sandbox that replays it and cannot load Sentry, so
// it cannot report an error itself; only a step can. And a step is retried
// (three more attempts by default) before the run is given up on, so reporting
// from inside a step would email about every transient blip. Reporting from the
// workflow's own `catch` — after the steps have run out of retries — is
// reporting the incident, not the attempts.
//
// What arrives in that `catch` is NOT the error the step threw. The runtime
// stores the step's message and stack and rebuilds `new FatalError(message)`
// with those two copied on. The class, `status` and any mark on the original
// object are gone, which has two consequences this file is built around:
//
//   - It cannot tell a refusal from a fault, or read a status. Every failure
//     that reaches it is a run that did not finish, and is reported as one.
//   - "A layer below already reported this" cannot be an object mark. A vendor
//     layer that reports from inside a step appends a marker line to the stack
//     (`lib/observability/workflow-context.ts`), which does survive, and a
//     marked failure is left to the layer that reported it. One failed run, one
//     report: by the vendor layer when one recognised it (with the vendor,
//     operation and status), by this one when none did.
//
// What this does NOT cover: a failure the workflow body catches and carries on
// from ("out of retries, the rest of the files still get their turn"). Those
// log with `console.error`, the sandbox shares the host's console, and console
// capture picks them up.

export interface WorkflowFailure {
  name: string;
  message: string;
  stack?: string;
}

/**
 * What groups failures of one workflow into issues. The name is no use for that
 * (it is `FatalError` for all of them by the time it arrives), so this reads the
 * first line of the message with what varies per run taken out: numbers, ids and
 * quoted values. "Lead 41 not found" and "Lead 97 not found" are one cause.
 */
export function failureSignature(message: string): string {
  // Redacted FIRST: the signature becomes the fingerprint, which is sent to
  // Sentry and stored with the issue, and a workflow error can carry a
  // recipient's address or phone number in its message.
  const firstLine = redactText(message.split("\n")[0] ?? "");
  return firstLine
    .toLowerCase()
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "#",
    )
    .replace(/\d+/g, "#")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * What to hand the reporting step, or `null` when it is not this layer's to
 * report: a run someone cancelled, or a failure a layer below has already
 * reported (its stack carries the marker). Pure, so it is safe inside the
 * workflow sandbox.
 */
export function describeFailure(error: unknown): WorkflowFailure | null {
  const read = (key: string): string | undefined =>
    typeof error === "object"
    && error !== null
    && typeof (error as Record<string, unknown>)[key] === "string"
      ? ((error as Record<string, unknown>)[key] as string)
      : undefined;

  const name = read("name") ?? "Error";
  const stack = read("stack");
  if (/cancel/i.test(name)) return null;
  if (stackSaysReported(stack)) return null;

  return {
    name,
    message: read("message") ?? String(error),
    ...(stack ? { stack } : {}),
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
  reportError(error, {
    source: `workflow:${workflow}`,
    tags: { workflow },
    // One issue per workflow and cause, not one per input message.
    fingerprint: ["workflow", workflow, failureSignature(failure.message)],
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
