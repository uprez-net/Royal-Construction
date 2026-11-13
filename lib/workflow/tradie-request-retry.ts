import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { TradieRequestDeliveryStatus } from "@prisma/client";
import { sleep } from "workflow";

import { systemPrincipal } from "@/lib/domain/principal";
import { MAX_AUTOMATIC_ATTEMPTS } from "@/lib/domain/tradies/request-delivery";
import { deliverTradieRequest } from "@/lib/domain/tradies/requests";
import { tradieRequestMail } from "@/lib/projects/tradie-request-mail";
import prisma from "@/lib/prisma";

/**
 * Retries one tradie request email that failed in a way that was clearly not
 * a send, on the schedule in lib/domain/tradies/request-delivery.ts.
 *
 * Started by the Server Action when a send comes back RETRYING. Each attempt
 * is a step, and the domain claims it against the status and attempt count it
 * expects, so a step the runtime replays — or a person pressing Retry in the
 * meantime — cannot send the same email twice: the second one finds nothing to
 * do and the run ends.
 */

const PRINCIPAL = systemPrincipal("workflow:tradie-request-retry");

/** Milliseconds until the next attempt is due, or null when none is. */
async function untilNextAttempt(recipientId: string): Promise<number | null> {
  "use step";
  const recipient = await prisma.tradieRequestRecipient.findUnique({
    select: { deliveryStatus: true, nextAttemptAt: true },
    where: { id: recipientId },
  });
  if (
    recipient?.deliveryStatus !== TradieRequestDeliveryStatus.RETRYING
    || !recipient.nextAttemptAt
  ) {
    return null;
  }
  return Math.max(0, recipient.nextAttemptAt.getTime() - Date.now());
}

async function attempt(
  recipientId: string,
): Promise<TradieRequestDeliveryStatus> {
  "use step";
  const outcome = await deliverTradieRequest(
    PRINCIPAL,
    { recipientId, trigger: "automatic" },
    prisma,
    tradieRequestMail,
  );
  return outcome.status;
}

/** The automatic retries after the first send; the bound is in the steps. */
async function automaticRetries(): Promise<number> {
  "use step";
  return MAX_AUTOMATIC_ATTEMPTS - 1;
}

// The workflow body stays to steps, `sleep` and literals: it runs in the
// workflow sandbox, which replays it, and has no business loading Prisma.
export const retryTradieRequestEmail = async (
  recipientId: string,
): Promise<string> => {
  "use workflow";
  try {
    return await runRetryTradieRequestEmail(recipientId);
  } catch (error) {
    await reportWorkflowError("retryTradieRequestEmail", error);
    throw error;
  }
};

// The body, split out so the workflow function above can report a run that
// fails once its steps are out of retries. A plain function: it runs in the
// same sandbox and calls its steps exactly as before.
const runRetryTradieRequestEmail = async (
  recipientId: string,
): Promise<string> => {
  const rounds = await automaticRetries();
  for (let round = 0; round < rounds; round += 1) {
    const wait = await untilNextAttempt(recipientId);
    if (wait === null) return "nothing to do";
    if (wait > 0) await sleep(wait);
    const status = await attempt(recipientId);
    if (status !== "RETRYING") return status;
  }
  return "RETRYING";
};
