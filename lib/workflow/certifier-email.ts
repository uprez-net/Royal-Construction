import { createHash } from "node:crypto";

import {
  CertifierEmailDirection,
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  Prisma,
} from "@prisma/client";
import { put } from "@vercel/blob";
import { FatalError } from "workflow";

import { classifyDocumentAtUrl } from "@/lib/agent/documentClassifierAgent";
import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import {
  collectLeadAttachments,
  type LeadAttachmentReport,
} from "@/lib/graph/lead-attachments";
import { withGraphRetry } from "@/lib/graph/retry";
import { notifyCompliance } from "@/lib/compliance/notify";
import prisma from "@/lib/prisma";
import { getAllAdminUsersIds } from "@/lib/data/user";
import { createActivityLogEntry } from "@/types/activityLog";
import { getAllEmailThreads, parseEmailDate } from "@/utils/email-parser";
import { buildBlobPath, normalizeEmailAddress } from "@/utils/formatters";
import { generateEmailChecksum } from "@/utils/generator";
import { logAction } from "@/lib/data/actionLog";

/**
 * The message, flattened to what this workflow needs.
 *
 * Passed in whole rather than re-fetched: the webhook has already read it from
 * Graph to decide it belongs to an engagement at all, and everything here is a
 * plain string. Same trade as InboundLeadMessage.
 */
export interface InboundCertifierMessage {
  messageId: string;
  /** The [RCCERT-…] token the webhook found in the subject. */
  refToken: string;
  subject: string;
  body: string;
  from: string;
  to: string;
  receivedDateTime: string;
}

export type InboundCertifierOutcome =
  | { status: "recorded"; engagementId: string; documents: number }
  | { status: "no-matching-engagement" };

/**
 * A document type that arriving on an email can legitimately set.
 *
 * A signed form is identified by where an admin uploaded it, never by reading
 * it, and a checklist item is produced by the extraction workflow. Neither can
 * be claimed by an inbound attachment, so the classifier's answer is narrowed
 * to what a certifier actually sends.
 */
const INBOUND_CLASSIFIABLE: ReadonlySet<ComplianceDocumentType> = new Set([
  ComplianceDocumentType.INVOICE,
  ComplianceDocumentType.FEE_PROPOSAL,
  ComplianceDocumentType.CDC_FORM,
  ComplianceDocumentType.CHECKLIST,
]);

// ---------------------------------------------------------------------------
// Steps — each is retried on its own and its result is persisted, so a crash
// between two of them resumes at the boundary rather than from the top.
// ---------------------------------------------------------------------------

/**
 * The Graph client is rebuilt inside each step rather than passed between them.
 * It holds a credential and a token cache — neither serializable, and neither
 * something to persist into an event log.
 */
async function graphClient() {
  return createGraphContext(getGraphConfig());
}

/**
 * A file id derived from the engagement and the Graph attachment it came from.
 *
 * This step can run twice — that is the deal with durable retries — and a
 * random id would mean a second blob and a second row for the same file. Same
 * inputs, same id: the re-run overwrites its own object and finds its own row
 * already there. Lifted from archiveLeadAttachments, where the same problem
 * has the same shape.
 */
function deterministicFileId(engagementId: string, attachmentId: string): string {
  const digest = createHash("sha256")
    .update(`certifier:${engagementId}:attachment:${attachmentId}`)
    .digest("hex");

  // Shaped as a UUID so it reads like every other File id in the table.
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

/**
 * Resolves the engagement the token points at.
 *
 * Returns null rather than throwing for a token with no engagement behind it:
 * that is a stale thread on a deleted project, which is a fact about the world
 * and not something a retry can fix.
 */
async function findEngagement(refToken: string) {
  "use step";
  return prisma.certifierEngagement.findUnique({
    where: { refToken },
    select: { id: true, projectId: true, subjectAddress: true },
  });
}

/**
 * Downloads and reads the attachments.
 *
 * The expensive step: every download and every OCR call happens here, once,
 * and what comes back is a description rather than the bytes. Reused wholesale
 * from the lead path — the policy about what is worth downloading (size caps,
 * inline signature images, unreadable formats) is identical, and a certifier
 * sends the same mix of PDFs and scans a client does.
 */
async function readAttachments(messageId: string): Promise<LeadAttachmentReport> {
  "use step";
  const client = await graphClient();
  const report = await collectLeadAttachments(client, messageId);

  if (report.names.length > 0) {
    console.log(
      `  Certifier attachments on ${messageId}: ${report.files.length} read, ` +
        `${report.skipped.length} skipped` +
        (report.skipped.length > 0
          ? ` — ${report.skipped.map((item) => `${item.name}: ${item.reason}`).join("; ")}`
          : ""),
    );
  }

  return report;
}

/**
 * Persists the message and everything it quotes.
 *
 * The body carries the whole thread, so getAllEmailThreads splits it back into
 * the individual messages and each gets its own checksum. Dedup rides entirely
 * on the unique index: a re-notification, a step retry and a reply quoting its
 * own history all converge on rows that already exist.
 *
 * Returns how many rows were new, purely for the log.
 */
async function saveInboundEmails(
  engagementId: string,
  message: InboundCertifierMessage,
  attachments: { name: string; url: string }[],
): Promise<number> {
  "use step";

  const sentAt = parseEmailDate(message.receivedDateTime) ?? new Date();
  const threads = getAllEmailThreads(message.body, {
    from: message.from,
    to: message.to,
    subject: message.subject,
    sentAt: message.receivedDateTime,
  });

  const rows: Prisma.CertifierEmailCreateManyInput[] = [];
  for (const [index, thread] of threads.entries()) {
    const subject = thread.subject.trim() || message.subject;
    const from = normalizeEmailAddress(thread.from || message.from);
    const to = normalizeEmailAddress(thread.to || message.to);
    const checksum = await generateEmailChecksum(subject, thread.body, from, to);

    rows.push({
      engagementId,
      emailFrom: from,
      emailTo: to,
      subject,
      body: thread.body,
      checksum,
      // getAllEmailThreads returns newest first, so only threads[0] is the
      // message that just arrived. The quoted history behind it is whatever
      // was said before, in both directions — but this system only ever sends
      // through sendCertifierReply, which writes its own OUTBOUND row. A
      // quoted copy of one of those collides on checksum and is skipped, so
      // labelling the whole quoted tail INBOUND cannot flip an existing row.
      direction: CertifierEmailDirection.INBOUND,
      attachments: (index === 0
        ? attachments
        : []) as unknown as Prisma.InputJsonValue,
      sentAt: parseEmailDate(thread.sentAt) ?? sentAt,
    });
  }

  if (rows.length === 0) {
    return 0;
  }

  const created = await prisma.certifierEmail.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return created.count;
}

/**
 * Stores the message's attachments and links them to the engagement.
 *
 * The bytes are pulled from the mailbox again rather than carried here: the
 * message is durable storage that already holds them, and a plan set has no
 * business travelling through a workflow's event log.
 *
 * Never throws. The email is already recorded, and losing an attachment is a
 * smaller failure than losing the fact that the certifier replied — so every
 * per-file failure is logged and skipped.
 */
async function archiveAttachments(
  engagementId: string,
  projectId: string,
  messageId: string,
  report: LeadAttachmentReport,
): Promise<{ documentId: string; fileId: string; name: string; url: string }[]> {
  "use step";

  if (report.files.length === 0) {
    return [];
  }

  // File.uploadedBy is a required relation, but nobody uploaded these — they
  // arrived on an email. An admin is the closest real actor the schema allows,
  // and it keeps the document visible to the people working the project.
  const [uploadedBy] = await getAllAdminUsersIds();
  if (!uploadedBy) {
    console.error(
      `  No admin user to attribute ${report.files.length} certifier attachment(s) to; leaving them unsaved.`,
    );
    return [];
  }

  const client = await graphClient();
  const stored: {
    documentId: string;
    fileId: string;
    name: string;
    url: string;
  }[] = [];

  for (const file of report.files) {
    try {
      const fileId = deterministicFileId(engagementId, file.id);

      const existing = await prisma.file.findUnique({
        where: { id: fileId },
        select: { id: true, url: true, filename: true, complianceDocumentId: true },
      });
      if (existing?.complianceDocumentId) {
        stored.push({
          documentId: existing.complianceDocumentId,
          fileId: existing.id,
          name: existing.filename,
          url: existing.url,
        });
        continue;
      }

      const data = await withGraphRetry(`download ${file.name}`, () =>
        client.downloadMessageAttachment(messageId, file.id),
      );

      const blob = await put(
        // Filed under the project rather than the engagement: the vault, the
        // blob-cleanup cron and every other file on the job all key on
        // projects/<id>/, and a second top-level prefix would hide these from
        // all three.
        buildBlobPath({ fileId, fileName: file.name, projectId }),
        data,
        {
          access: "public",
          // The path is already unique through fileId, and a suffix would
          // break the shape the blob cleanup cron matches on.
          addRandomSuffix: false,
          // A retry that got as far as uploading last time writes the same
          // object again rather than failing on it.
          allowOverwrite: true,
          contentType: file.mediaType,
        },
      );

      // RECEIVED, not UPLOADED: this arrived on an email rather than being put
      // there by an admin, and only the second is something a person can be
      // asked to redo. Type is UNKNOWN until the classifier runs — the row is
      // created first so a classification failure still leaves the document
      // stored and visible.
      const document = await prisma.complianceDocument.create({
        data: {
          engagementId,
          documentType: ComplianceDocumentType.UNKNOWN,
          status: ComplianceDocumentStatus.RECEIVED,
          label: file.name,
        },
      });

      await prisma.file.create({
        data: {
          id: fileId,
          uploadedBy,
          complianceDocumentId: document.id,
          url: blob.url,
          filename: file.name,
          fileType: file.mediaType,
          filesize: data.byteLength,
        },
      });

      stored.push({
        documentId: document.id,
        fileId,
        name: file.name,
        url: blob.url,
      });
    } catch (error) {
      console.error(`  Failed to archive certifier attachment "${file.name}":`, error);
    }
  }

  return stored;
}

/**
 * Labels each stored attachment.
 *
 * Runs after the documents exist, so a classification that fails leaves them
 * as UNKNOWN rather than losing them. The classifier's answer is narrowed to
 * the four types a certifier actually sends — anything else it returns is
 * treated as UNKNOWN, because a required document arriving back from the
 * certifier is not a thing that happens and would overwrite the copy the
 * project already holds.
 */
async function classifyStoredDocuments(
  stored: { documentId: string; name: string; url: string }[],
): Promise<{ labelled: number; checklistDocumentId: string | null }> {
  "use step";

  let labelled = 0;
  let checklistDocumentId: string | null = null;

  for (const item of stored) {
    try {
      const result = await classifyDocumentAtUrl(item.url, item.name);
      if (
        result.documentType === ComplianceDocumentType.UNKNOWN ||
        !INBOUND_CLASSIFIABLE.has(result.documentType)
      ) {
        console.log(`  "${item.name}" left unclassified: ${result.message}`);
        continue;
      }

      await prisma.complianceDocument.update({
        where: { id: item.documentId },
        data: { documentType: result.documentType },
      });
      labelled += 1;

      // Reported back so the notification can offer to run the extraction. A
      // certifier who attaches two checklists is answered with the first.
      if (
        result.documentType === ComplianceDocumentType.CHECKLIST &&
        !checklistDocumentId
      ) {
        checklistDocumentId = item.documentId;
      }
    } catch (error) {
      console.error(`  Failed to classify "${item.name}":`, error);
    }
  }

  return { labelled, checklistDocumentId };
}

/**
 * Moves the engagement to RESPONSE_RECEIVED, writes the audit entry and tells
 * the admins.
 *
 * The status move is guarded so a second reply on the same thread does not
 * drag a signing or tracking engagement back to the start.
 */
async function advanceAndNotify(
  engagement: { id: string; projectId: string },
  message: InboundCertifierMessage,
  documentCount: number,
  checklistDocumentId: string | null,
): Promise<void> {
  "use step";

  // The message id is stamped unconditionally, outside the status guard: a
  // second reply on an engagement that has already moved past
  // RESPONSE_RECEIVED still has to become the message the next reply threads
  // onto, or the conversation forks off the latest turn.
  await prisma.certifierEngagement.update({
    where: { id: engagement.id },
    data: { lastInboundMessageId: message.messageId },
  });

  await prisma.certifierEngagement.updateMany({
    where: {
      id: engagement.id,
      status: {
        in: [
          CertifierEngagementStatus.OUTREACH_SENT,
          CertifierEngagementStatus.AWAITING_RESPONSE,
        ],
      },
    },
    data: { status: CertifierEngagementStatus.RESPONSE_RECEIVED },
  });

  await logAction(
    createActivityLogEntry("certifierResponseReceived", {
      projectId: engagement.projectId,
      engagementId: engagement.id,
      emailFrom: message.from,
      subject: message.subject,
      attachmentCount: documentCount,
    }),
  );

  await notifyCompliance("certifierResponseReceived", engagement.projectId, {
    engagementId: engagement.id,
    attachmentCount: documentCount,
    // Only set when a checklist actually arrived. The template uses its
    // presence to decide whether the notification offers to run the extraction
    // at all, so a reply that is just an invoice does not open a popup with
    // nothing to work on.
    ...(checklistDocumentId ? { checklistDocumentId } : {}),
  });
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Turns one inbound certifier email into recorded documents.
 *
 * This is the half of the webhook that cannot afford to run inline. Graph is
 * told 202 before any of it starts, so a timeout downloading a plan set, a
 * rate-limited classification, or a cold-start kill anywhere along the way
 * would lose the certifier's reply with no trace and no second attempt — and
 * unlike a lead, nothing else in the system would ever notice the gap. As a
 * workflow each step retries on its own and the run resumes at the last
 * boundary it cleared.
 *
 * The caller has already found the token in the subject and rejected bounces
 * and auto-replies. Everything screened out upstream never reaches here.
 */
export const processInboundCertifierEmail = async (
  message: InboundCertifierMessage,
): Promise<InboundCertifierOutcome> => {
  "use workflow";

  if (!message.messageId) {
    // Nothing downstream can be made idempotent without it, so this is not
    // worth retrying.
    throw new FatalError("processInboundCertifierEmail requires a messageId.");
  }

  const engagement = await findEngagement(message.refToken);
  if (!engagement) {
    console.log(
      `  No certifier engagement for token ${message.refToken}; ignoring message ${message.messageId}.`,
    );
    return { status: "no-matching-engagement" };
  }

  const report = await readAttachments(message.messageId);
  const stored = await archiveAttachments(
    engagement.id,
    engagement.projectId,
    message.messageId,
    report,
  );

  await saveInboundEmails(
    engagement.id,
    message,
    stored.map((item) => ({ name: item.name, url: item.url })),
  );

  let checklistDocumentId: string | null = null;
  if (stored.length > 0) {
    const classification = await classifyStoredDocuments(stored);
    checklistDocumentId = classification.checklistDocumentId;
    console.log(
      `  Classified ${classification.labelled} of ${stored.length} certifier document(s).`,
    );
  }

  await advanceAndNotify(
    engagement,
    message,
    stored.length,
    checklistDocumentId,
  );

  return {
    status: "recorded",
    engagementId: engagement.id,
    documents: stored.length,
  };
};
