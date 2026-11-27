import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { sleep } from "workflow";

import {
  deliverOwnerCallHandoff,
  verifyHandoffActed,
} from "@/lib/domain/comms/calls/owner-call-handoff";
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
 *   reopened          overtaken while Hermes answered (a request noted late,
 *                     a callback that didn't ring): sent again straight away
 *   delivered         only means Hermes answered 2xx. Ten minutes later the
 *                     handoff is checked: still unresolved, it is reopened
 *                     once (a new revision saying what was missed) and sent
 *                     again; ten minutes after that, still unresolved, it is
 *                     FAILED and reported, so a dropped request is never quiet
 *   needs_attention   Hermes ended with RESULT: needs_owner or cannot: FAILED
 *                     and reported at once
 *   voicemail         a callback the owner's voicemail answered: the handoff it
 *                     came from is reopened and delivered, this one closed
 */

async function deliver(
  handoffId: string,
  waitForTranscript: boolean,
): Promise<string> {
  "use step";
  // Built inside the step: nothing from the domain at module level, so the
  // workflow sandbox never loads it.
  const outcome = await deliverOwnerCallHandoff(
    systemPrincipal("workflow:owner-call-handoff"),
    { handoffId, waitForTranscript },
    prisma,
    {
      assistant: hermesAssistant(readHermesConfig()),
      // Not imported at the top: that module imports this workflow.
      startDelivery: async (id) => {
        const { startHandoffDeliveries } =
          await import("@/lib/comms/owner-call-handoffs");
        await startHandoffDeliveries([id]);
      },
    },
  );
  if (outcome === "needs_attention") {
    console.error(
      `[owner-calls] handoff ${handoffId}: Hermes can't go on without the owner, or can't do it; it needs a person (Admin → Agent calls)`,
    );
  }
  return outcome;
}
// Never retried by the runtime: the domain records every try, and Hermes
// receiving one twice is what the claim is there to avoid.
deliver.maxRetries = 0;

async function verify(handoffId: string, final: boolean): Promise<string> {
  "use step";
  const verdict = await verifyHandoffActed(
    systemPrincipal("workflow:owner-call-handoff"),
    { final, handoffId },
    prisma,
  );
  if (verdict === "failed") {
    console.error(
      `[owner-calls] handoff ${handoffId} was taken by Hermes but never acted on; it needs a person (Admin → Agent calls)`,
    );
  }
  return verdict;
}
verify.maxRetries = 0;

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
  // The recording's speech-to-text lands about 25 s after hangup, and it is
  // the more accurate transcript, so give it time before the first send.
  await sleep("45s");
  let outcome = await deliver(handoffId, true);
  // The last wait sends it without a transcript rather than waiting again.
  for (let wait = 0; outcome === "waiting" && wait < 6; wait += 1) {
    await sleep("1m");
    outcome = await deliver(handoffId, wait < 5);
  }
  let retries = 0;
  // Bounded: each pass is one try at Hermes or one reopening caught up with.
  for (let pass = 0; pass < 8; pass += 1) {
    // Reopened while it was going (a request noted late, a callback that
    // didn't ring): what Hermes has is out of date, so send it again now.
    if (outcome === "reopened") {
      outcome = await deliver(handoffId, false);
      continue;
    }
    if (outcome !== "failed" || retries >= RETRY_AFTER.length) break;
    await sleep(RETRY_AFTER[retries]);
    retries += 1;
    outcome = await deliver(handoffId, false);
  }
  // Hermes took it. That is not the same as having done it: check, and give
  // it one more go before calling it dropped.
  for (let check = 0; outcome === "delivered" && check < 2; check += 1) {
    await sleep("10m");
    const verdict = await verify(handoffId, check === 1);
    if (verdict === "failed") return "unacted";
    if (verdict !== "reopened") break;
    outcome = await deliver(handoffId, false);
  }
  return outcome;
};
