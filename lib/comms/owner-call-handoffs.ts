import { start } from "workflow/api";

import { deliverOwnerCallHandoffRun } from "@/lib/workflow/owner-call-handoff";

// Starting the run that passes an owner call's handoff to Hermes
// (lib/workflow/owner-call-handoff.ts). Three callers: Mili's report at the
// end of her call (lib/comms/voice-agent/stream-handler.ts), the carrier's
// last status for the call (the comms webhook route), and the hourly
// owner-calls backstop for one whose run was lost or that failed. A second
// run for one handoff is harmless (the domain's claim lets one send it).
//
// Never throws: a run that did not start is the backstop's to start, and the
// handoff stays PENDING — outstanding, never lost — until it does.

export async function startHandoffDeliveries(
  handoffIds: readonly string[],
  startRun: typeof start = start,
): Promise<number> {
  let started = 0;
  for (const handoffId of new Set(handoffIds)) {
    try {
      await startRun(deliverOwnerCallHandoffRun, [handoffId]);
      started += 1;
    } catch (error) {
      console.error(
        `[owner-calls] could not start delivering handoff ${handoffId} to Hermes; the hourly backstop will`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return started;
}
