import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { put } from "@/lib/blob";

import { readTradieInvoiceBytes } from "@/lib/agent/tradieInvoiceExtractionAgent";
import { findAdminUserIds } from "@/lib/domain/identity/users";
import { systemPrincipal } from "@/lib/domain/principal";
import {
  invoiceAttachmentCandidates,
  placeEmailedTradieInvoice,
  queueEmailedTradieInvoice,
  type EmailedInvoicePlacement,
  type InvoiceAttachmentCandidate,
} from "@/lib/domain/tradies/invoice-inbox";
import { tradieInvoiceDocumentFolder } from "@/lib/domain/tradies/invoice-document-files";
import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { withGraphRetry } from "@/lib/graph/retry";
import { triggerNotification } from "@/lib/notification/novu";
import prisma from "@/lib/prisma";
import { createNotification } from "@/types/notification";

/**
 * A tradie's email with attachments: find the invoices among them, read them,
 * and queue each against the project and booking it bills, for the office to
 * confirm (lib/domain/tradies/invoice-inbox.ts).
 *
 * The webhook only enqueues this. Downloading, OCR and the model call are the
 * slow, failure-prone half, so each attachment is a step of its own: retried
 * on its own, and resumed at the last one that landed. Nothing here counts in
 * a job's figures — that waits for somebody to confirm it.
 */
export interface TradieInvoiceEmailInput {
  readonly graphMessageId: string;
  readonly mailbox: "business" | "admin";
  readonly tradieId: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  /** ISO. */
  readonly receivedAt: string;
}

const LOG = "[tradie-invoice-email]";
const PRINCIPAL = systemPrincipal("workflow:tradie-invoice-email");

/** Rebuilt in each step: the client holds a credential and a token cache. */
async function graph(mailbox: TradieInvoiceEmailInput["mailbox"]) {
  return createGraphContext(getGraphConfig(mailbox));
}

type Plan = {
  readonly placement: EmailedInvoicePlacement;
  readonly files: readonly InvoiceAttachmentCandidate[];
};

async function planInvoiceEmail(input: TradieInvoiceEmailInput): Promise<Plan> {
  "use step";
  const client = await graph(input.mailbox);
  const attachments = await withGraphRetry(
    "list tradie invoice attachments",
    () => client.listMessageAttachments(input.graphMessageId),
  );
  return {
    files: invoiceAttachmentCandidates(attachments),
    placement: await placeEmailedTradieInvoice(
      PRINCIPAL,
      { body: input.body, subject: input.subject, tradieId: input.tradieId },
      prisma,
    ),
  };
}

type AttachmentOutcome = "queued" | "duplicate" | "not-an-invoice" | "unplaced";

/** Read one attachment and, when it is an invoice for a known project, queue it. */
async function processAttachment(
  input: TradieInvoiceEmailInput,
  placement: EmailedInvoicePlacement,
  file: InvoiceAttachmentCandidate,
): Promise<AttachmentOutcome> {
  "use step";
  const client = await graph(input.mailbox);
  const data = await withGraphRetry("download tradie invoice attachment", () =>
    client.downloadMessageAttachment(input.graphMessageId, file.id),
  );
  const reading = await readTradieInvoiceBytes({
    contentType: file.contentType,
    data,
    fileName: file.name,
  });
  if (reading.documentKind !== "INVOICE") return "not-an-invoice";
  if (!placement.projectId) return "unplaced";

  // A fixed path per message and attachment, inside the project's invoice
  // folder that recording it checks for: a retry overwrites its own object.
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
  const blob = await put(
    `${tradieInvoiceDocumentFolder(placement.projectId)}email/${input.graphMessageId.slice(-24).replace(/[^\w-]/g, "_")}-${file.id.slice(-12).replace(/[^\w-]/g, "_")}-${safeName}`,
    data,
    {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: file.contentType,
    },
  );

  const queued = await queueEmailedTradieInvoice(
    PRINCIPAL,
    {
      attachmentId: file.id,
      document: { name: file.name, url: blob.url },
      dueDate: reading.dueDate,
      fromAddress: input.from,
      graphMessageId: input.graphMessageId,
      invoiceNumber: reading.invoiceNumber,
      issuedDate: reading.issuedDate,
      mailbox: input.mailbox,
      projectId: placement.projectId,
      receivedAt: new Date(input.receivedAt),
      scheduleId: placement.scheduleId,
      subTotal: reading.subTotal,
      subject: input.subject,
      total: reading.total,
      totalTax: reading.totalTax,
      tradieId: placement.tradie.id,
    },
    prisma,
  );
  return queued.outcome === "queued" ? "queued" : "duplicate";
}

/** Tell the office: what is waiting, or what could not be placed. */
async function notifyOffice(
  input: TradieInvoiceEmailInput,
  placement: EmailedInvoicePlacement,
  counts: { readonly queued: number; readonly unplaced: number },
): Promise<void> {
  "use step";
  const admins = await findAdminUserIds(prisma);
  // An empty list means everyone to Novu; with no admins, tell nobody.
  if (admins.length === 0) return;
  if (counts.queued > 0 && placement.projectId) {
    await triggerNotification(
      admins,
      createNotification("tradieInvoiceEmailed", {
        count: counts.queued,
        projectId: placement.projectId,
        projectName: placement.projectName ?? "the project",
        tradieName: placement.tradie.name,
      }),
    );
  }
  if (counts.unplaced > 0) {
    await triggerNotification(
      admins,
      createNotification("tradieInvoiceEmailUnmatched", {
        subject: input.subject || "(no subject)",
        tradieId: placement.tradie.id,
        tradieName: placement.tradie.name,
      }),
    );
  }
}

export const processTradieInvoiceEmail = async (
  input: TradieInvoiceEmailInput,
): Promise<Record<AttachmentOutcome | "failed", number>> => {
  "use workflow";
  try {
    return await runProcessTradieInvoiceEmail(input);
  } catch (error) {
    await reportWorkflowError("processTradieInvoiceEmail", error);
    throw error;
  }
};

// The body, split out so the workflow function above can report a run that
// fails once its steps are out of retries. A plain function: it runs in the
// same sandbox and calls its steps exactly as before.
const runProcessTradieInvoiceEmail = async (
  input: TradieInvoiceEmailInput,
): Promise<Record<AttachmentOutcome | "failed", number>> => {
  const { placement, files } = await planInvoiceEmail(input);
  const counts: Record<AttachmentOutcome | "failed", number> = {
    duplicate: 0,
    failed: 0,
    "not-an-invoice": 0,
    queued: 0,
    unplaced: 0,
  };
  for (const file of files) {
    try {
      counts[await processAttachment(input, placement, file)] += 1;
    } catch (error) {
      // Out of retries. Logged with the file's name so it can be found in
      // Outlook; the other attachments still get their turn.
      counts.failed += 1;
      console.error(
        `${LOG} ${input.graphMessageId} "${file.name}": could not be read`,
        error,
      );
    }
  }

  if (counts.queued > 0 || counts.unplaced > 0) {
    await notifyOffice(input, placement, counts);
  }
  console.log(
    `${LOG} ${input.graphMessageId} from ${placement.tradie.name}: ${JSON.stringify(counts)}`,
  );
  return counts;
};
