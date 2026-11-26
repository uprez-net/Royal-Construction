import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { sleep } from "workflow";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { placeOwnerCall } from "@/lib/domain/comms/calls/owner-call";
import { systemPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";

/**
 * Rings one scheduled owner call at its time (lib/domain/comms/calls/
 * owner-call.ts).
 *
 * A durable sleep rather than a cron polling for due calls: the run costs
 * nothing while it waits — no function, no database read — and rings on the
 * minute. Started when Hermes schedules the call (app/api/agent/effects), and
 * again by the hourly owner-calls backstop for anything due within the hour,
 * in case the first start was lost. Two runs for one call are harmless: the
 * domain claims the call SCHEDULED → PLACING, so the second finds nothing to
 * do, and a call cancelled meanwhile is never claimed at all.
 *
 * Mili already on a call to the owner (or the hourly cap reached) defers it:
 * the run waits a minute and tries again, and the domain drops it as missed
 * once it is half an hour late.
 */

async function ring(ownerCallId: string): Promise<string> {
  "use step";
  // Built inside the step: nothing from the domain at module level, so the
  // workflow sandbox never loads it.
  const runtime = commsRuntimeFromEnv();
  const principal = systemPrincipal("workflow:owner-call");
  return placeOwnerCall(principal, { ownerCallId }, prisma, {
    channel: runtime.channel,
    voice: runtime.voice,
  });
}
// Never retried by the runtime: a step that failed after the carrier may have
// rung must not ring again. placeOwnerCall records the failure on the call.
ring.maxRetries = 0;

// The body stays to steps, `sleep` and literals: it runs in the workflow
// sandbox, which replays it, and has no business loading Prisma.
export const ringOwnerCallAt = async (
  ownerCallId: string,
  callAtIso: string,
): Promise<string> => {
  "use workflow";
  try {
    return await runRingOwnerCallAt(ownerCallId, callAtIso);
  } catch (error) {
    await reportWorkflowError("ringOwnerCallAt", error);
    throw error;
  }
};

/** A minute between tries while Mili is busy; 35 covers the 30-minute window. */
const runRingOwnerCallAt = async (
  ownerCallId: string,
  callAtIso: string,
): Promise<string> => {
  const callAt = new Date(callAtIso);
  if (callAt.getTime() > Date.now()) await sleep(callAt);
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const outcome = await ring(ownerCallId);
    if (outcome !== "deferred") return outcome;
    await sleep("1m");
  }
  return "deferred";
};
