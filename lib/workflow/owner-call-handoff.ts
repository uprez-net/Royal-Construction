import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { sleep } from "workflow";

import { deliverOwnerCallHandoff } from "@/lib/domain/comms/calls/owner-call-handoff";
import { systemPrincipal } from "@/lib/domain/principal";
import { hermesAssistant } from "@/lib/hermes/assistant";
import { readHermesConfig } from "@/lib/hermes/config";
import prisma from "@/lib/prisma";

/**
 * Passes one owner call's post-call handoff to Hermes
 * (lib/domain/comms/calls/owner-call-handoff.ts).
 *
 * Started when the call ends (Mili's report or the carrier's last status,
 * whichever made it ready), and again by the hourly owner-calls backstop for
 * one whose run was lost or that failed. Two runs for one handoff are
 * harmless: the domain claims it PENDING → DELIVERING, so only one sends it.
 *
 *   a short wait      the other end-of-call event and the transcript land
 *   no transcript yet an answered call waits (a minute at a time, up to the
 *                     domain's transcriptWaitMinutes) for the recording's
 *   failed            tried again after 1, 5 and 15 minutes; then left FAILED
 *                     for the hourly backstop, outstanding and shown
 *   unavailable       Hermes isn't connected: stop; Hermes can still pull it
 *                     through list_owner_call_handoffs
 */

async function deliver(
  handoffId: string,
  waitForTranscript: boolean,
): Promise<string> {
  "use step";
  // Built inside the step: nothing from the domain at module level, so the
  // workflow sandbox never loads it.
  return deliverOwnerCallHandoff(
    systemPrincipal("workflow:owner-call-handoff"),
    { handoffId, waitForTranscript },
    prisma,
    { assistant: hermesAssistant(readHermesConfig()) },
  );
}
// Never retried by the runtime: the domain records every try, and Hermes
// receiving one twice is what the claim is there to avoid.
deliver.maxRetries = 0;

export const deliverOwnerCallHandoffRun = async (
  handoffId: string,
): Promise<string> => {
  "use workflow";
  try {
    return await runDeliverOwnerCallHandoff(handoffId);
  } catch (error) {
    await reportWorkflowError("deliverOwnerCallHandoffRun", error);
    throw error;
  }
};

const RETRY_AFTER = ["1m", "5m", "15m"] as const;

const runDeliverOwnerCallHandoff = async (
  handoffId: string,
): Promise<string> => {
  await sleep("20s");
  let outcome = await deliver(handoffId, true);
  // The last wait sends it without a transcript rather than waiting again.
  for (let wait = 0; outcome === "waiting" && wait < 6; wait += 1) {
    await sleep("1m");
    outcome = await deliver(handoffId, wait < 5);
  }
  for (const delay of RETRY_AFTER) {
    if (outcome !== "failed") return outcome;
    await sleep(delay);
    outcome = await deliver(handoffId, false);
  }
  return outcome;
};
