import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { put } from "@vercel/blob";

import {
  planOfferReplyAttachments,
  storeOfferReplyAttachment,
  type OfferReplyAttachmentPlan,
  type OfferReplyMailPort,
  type PlannedReplyAttachment,
} from "@/lib/domain/offers/replies";
import { systemPrincipal } from "@/lib/domain/principal";
import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { withGraphRetry } from "@/lib/graph/retry";
import prisma from "@/lib/prisma";

/**
 * Stores the attachments on a client's offer reply, after the reply itself.
 *
 * The webhook writes the message and the timestamps inline and hands the rest
 * here: downloading and uploading files is the slow, failure-prone half, and
 * inside the webhook's after() a timeout or a Graph hiccup lost them with no
 * second attempt. Here each file is its own step, retried on its own and
 * resumed at the last one that landed.
 */
export interface OfferReplyAttachmentsInput {
  readonly replyId: string;
  readonly graphMessageId: string;
}

const PRINCIPAL = systemPrincipal("workflow:offer-reply-attachments");

/**
 * The Graph client is rebuilt inside each step rather than passed between them.
 * It holds a credential and a token cache — neither serializable. Offer mail
 * is only ever correlated on the business mailbox (see the Graph webhook).
 */
async function mailPort(graphMessageId: string): Promise<OfferReplyMailPort> {
  const client = await createGraphContext(getGraphConfig("business"));
  return {
    downloadAttachment: (attachmentId) =>
      withGraphRetry("download offer reply attachment", () =>
        client.downloadMessageAttachment(graphMessageId, attachmentId),
      ),
    listAttachments: () =>
      withGraphRetry("list offer reply attachments", () =>
        client.listMessageAttachments(graphMessageId),
      ),
  };
}

async function planAttachments(
  input: OfferReplyAttachmentsInput,
): Promise<OfferReplyAttachmentPlan> {
  "use step";
  return planOfferReplyAttachments(
    PRINCIPAL,
    { replyId: input.replyId },
    prisma,
    { mail: await mailPort(input.graphMessageId) },
  );
}

async function storeAttachment(
  plan: Omit<OfferReplyAttachmentPlan, "files">,
  file: PlannedReplyAttachment,
): Promise<{ url: string }> {
  "use step";
  return storeOfferReplyAttachment(PRINCIPAL, { file, plan }, prisma, {
    mail: await mailPort(plan.graphMessageId),
    put: ({ allowOverwrite, body, contentType, pathname }) =>
      put(
        pathname,
        body instanceof Uint8Array && !Buffer.isBuffer(body)
          ? Buffer.from(body)
          : body,
        {
          // Same as every other stored email attachment here: the path is
          // already unique, and a suffix would stop a retry overwriting its
          // own object.
          access: "public",
          addRandomSuffix: false,
          allowOverwrite,
          contentType,
        },
      ),
  });
}

export const storeOfferReplyAttachments = async (
  input: OfferReplyAttachmentsInput,
): Promise<{ planned: number; stored: number }> => {
  "use workflow";
  try {
    return await runStoreOfferReplyAttachments(input);
  } catch (error) {
    await reportWorkflowError("storeOfferReplyAttachments", error);
    throw error;
  }
};

// The body, split out so the workflow function above can report a run that
// fails once its steps are out of retries. A plain function: it runs in the
// same sandbox and calls its steps exactly as before.
const runStoreOfferReplyAttachments = async (
  input: OfferReplyAttachmentsInput,
): Promise<{ planned: number; stored: number }> => {

  const { files, ...plan } = await planAttachments(input);

  let stored = 0;
  for (const file of files) {
    try {
      await storeAttachment(plan, file);
      stored += 1;
    } catch (error) {
      // Out of retries. The plan left this file's note as "Not saved", which
      // is now the truth, so the rest of the files still get their turn.
      console.error(
        `  Offer reply ${input.replyId}: couldn't save "${file.name}"`,
        error,
      );
    }
  }

  console.log(
    `  Offer reply ${input.replyId}: stored ${stored} of ${files.length} attachment(s).`,
  );
  return { planned: files.length, stored };
};
