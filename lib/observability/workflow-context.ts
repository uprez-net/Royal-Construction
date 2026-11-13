// Carrying "this failure was already reported" across a workflow step.
//
// A failure thrown inside a step does not reach the workflow body as the error
// that was thrown. The Workflow runtime stores its message and stack on the
// step_failed event and rebuilds `new FatalError(message)` with those two copied
// back on (`@workflow/core`, `step.js`). The class, the name, `status` and any
// mark an earlier layer set on the object are gone, so "I already reported this"
// cannot travel as a property of the error.
//
// What does travel is the stack string. When a layer reports an error from
// inside a step, it appends a marker line to `error.stack`; the workflow's own
// report (`lib/workflow/report-failure.ts`) looks for it and stays quiet. One
// failed run is then one report, made by whichever layer saw it first and knew
// most: the vendor layer, with its status and operation, or the workflow layer
// for a failure no vendor layer recognised.
//
// Pure, with no imports: `describeFailure` runs in the workflow sandbox and this
// module also ships to the browser.

/** A line no stack parser mistakes for a frame, so it adds no fake frame. */
export const REPORTED_STACK_MARKER = "[royal.observability:reported]";

// Process-wide, per `@workflow/core`: it is stored on `globalThis` under a
// `Symbol.for` key precisely so that bundlers cannot create two copies. Reading
// it needs no import of `workflow`.
const STEP_CONTEXT_STORAGE = Symbol.for("WORKFLOW_STEP_CONTEXT_STORAGE");

/** True while code is running inside a Workflow step. */
export function inWorkflowStep(): boolean {
  try {
    const storage = (
      globalThis as unknown as Record<
        symbol,
        { getStore?: () => unknown } | undefined
      >
    )[STEP_CONTEXT_STORAGE];
    return storage?.getStore?.() !== undefined;
  } catch {
    return false;
  }
}

/** True if a stack string says some layer already reported this failure. */
export function stackSaysReported(stack: string | undefined): boolean {
  return typeof stack === "string" && stack.includes(REPORTED_STACK_MARKER);
}

/**
 * Inside a step, tags the error's stack so a later layer can tell it was
 * reported. Outside a step it does nothing: nothing rebuilds the error there, so
 * the object-level mark is enough and the stack is left exactly as it was.
 *
 * Call it AFTER the event has been captured, so the marker is not part of what is
 * sent.
 */
export function carryReportAcrossSteps(error: unknown): void {
  if (!inWorkflowStep()) return;
  if (typeof error !== "object" || error === null) return;
  try {
    const target = error as { stack?: unknown };
    if (typeof target.stack !== "string" || stackSaysReported(target.stack)) {
      return;
    }
    target.stack = `${target.stack}\n${REPORTED_STACK_MARKER}`;
  } catch {
    // A frozen error cannot be tagged; the worst case is one extra report.
  }
}
