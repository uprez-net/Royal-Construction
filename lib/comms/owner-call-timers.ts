import { start } from "workflow/api";

import { ownerCallsToArm } from "@/lib/domain/comms/calls/owner-call";
import type { DomainDb } from "@/lib/domain/db";
import { systemPrincipal } from "@/lib/domain/principal";
import { ringOwnerCallAt } from "@/lib/workflow/owner-call";

// Starting the timer that rings a scheduled owner call at its time
// (lib/workflow/owner-call.ts). Two callers: the agent-effects route, right
// after Hermes schedules a call, and the hourly owner-calls backstop, for any
// call due within the hour whose first start was lost. A second timer for
// one call is harmless (the domain's claim lets one of them ring), so neither
// caller needs to know whether the other already ran.

export async function armOwnerCallTimers(
  input:
    | { readonly ownerCallIds: readonly string[] }
    | { readonly dueBefore: Date },
  db: DomainDb,
  startRun: typeof start = start,
): Promise<number> {
  const calls = await ownerCallsToArm(
    systemPrincipal("owner-call-timers"),
    input,
    db,
  );
  let armed = 0;
  for (const call of calls) {
    try {
      await startRun(ringOwnerCallAt, [call.id, call.callAt.toISOString()]);
      armed += 1;
    } catch (error) {
      // The hourly backstop arms it again before it is due.
      console.error(
        `[owner-calls] could not start the timer for owner call ${call.id}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return armed;
}
