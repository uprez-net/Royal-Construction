import { createHash } from "node:crypto";

import {
  CertifierEmailDirection,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceOutreachStatus,
  CompliancePartyType,
  Prisma,
} from "@prisma/client";
import { put } from "@vercel/blob";
import { FatalError } from "workflow";

import { detectComplianceAlerts } from "@/lib/agent/complianceAlertAgent";
import { classifyDocumentAtUrl } from "@/lib/agent/documentClassifierAgent";
import { PARTY_INBOUND_DOCUMENT_TYPES, PARTY_LABEL } from "@/constants/complianceDocuments";
import {
  discardSupersededFiles,
  placeInboundDocument,
} from "@/lib/compliance/document-replacement";
import { raiseComplianceAlert } from "@/lib/data/compliance-alerts";
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
 * One inbound message on a surveyor, architect or council thread.
 *
 * The same shape `InboundCertifierMessage` has, and passed in whole for the
 * same reason: the webhook has already read it from Graph to decide it belongs
 * to an outreach at all, and everything here is a plain string.
 */
export interface InboundPartyMessage {
  messageId: string;
  /** The [RCSURV-…] / [RCARCH-…] / [RCCOUN-…] token found in the subject. */
  refToken: string;
  subject: string;
  body: string;
  from: string;
  to: string;
  receivedDateTime: string;
}

export type InboundPartyOutcome =
  | {
      status: "recorded";
      outreachId: string;
      party: CompliancePartyType;
      documents: number;
      alerts: number;
    }
  | { status: "no-matching-outreach" };

// ---------------------------------------------------------------------------
// Steps
//
// This is deliberately a sibling of lib/workflow/certifier-email.ts rather than
// a generalisation of it. The two share a shape -- read attachments, archive
// them, save the mail, classify, advance -- but differ in the two places that
// matter: what an attachment may be classified as is narrowed per party here
// rather than to one fixed set, and this one reads the body for conditions that
// change the file, which a certifier reply never carries. Folding them together
// would put a party parameter through every step of a workflow that is live and
// working, to save a structure neither of them would then own.
// ---------------------------------------------------------------------------

async function graphClient() {
  return createGraphContext(getGraphConfig());
}

/**
 * A file id derived from the outreach and the Graph attachment it came from.
 *
 * Durable retries mean this step can run twice, and a random id would mean a
 * second blob and a second row for the same file. Same inputs, same id.
 */
function deterministicFileId(outreachId: string, attachmentId: string): string {
  const digest = createHash("sha256")
    .update(`party:${outreachId}:attachment:${attachmentId}`)
    .digest("hex");

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

/**
 * Resolves the outreach the token points at.
 *
 * Null rather than a throw for a token with nothing behind it: that is a stale
 * thread on a deleted project, which is a fact about the world and not
 * something a retry can fix.
 */
async function findOutreach(refToken: string) {
  "use step";
  return prisma.complianceOutreach.findUnique({
    where: { refToken },
    select: {
      id: true,
      party: true,
      engagementId: true,
      engagement: { select: { projectId: true } },
    },
  });
}

/**
 * Downloads and reads the attachments.
 *
 * Reused wholesale from the lead and certifier paths: the policy about what is
 * worth downloading — size caps, inline signature images, unreadable formats —
 * is identical, and a surveyor sends the same mix of PDFs and scans.
 */
async function readAttachments(
  messageId: string,
): Promise<LeadAttachmentReport> {
  "use step";
  const client = await graphClient();
  const report = await collectLeadAttachments(client, messageId);

  if (report.names.length > 0) {
    console.log(
      `  Party attachments on ${messageId}: ${report.files.length} read, ` +
        `${report.skipped.length} skipped` +
        (report.skipped.length > 0
          ? ` — ${report.skipped.map((item) => `${item.name}: ${item.reason}`).join("; ")}`
          : ""),
    );
  }

  return report;
}

/**
 * Persists the message and everything it quotes, under this party's thread.
 *
 * The body carries the whole conversation, so it is split back into individual
 * messages and each gets its own checksum. Dedup rides entirely on the unique
 * index, exactly as the certifier path does — and it is the same index, because
 * this is the same table: a quoted copy of one of our own outbound messages
 * collides on checksum and is skipped rather than being re-filed as inbound.
 */
async function saveInboundEmails(
  engagementId: string,
  outreachId: string,
  message: InboundPartyMessage,
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
      outreachId,
      emailFrom: from,
      emailTo: to,
      subject,
      body: thread.body,
      checksum,
      direction: CertifierEmailDirection.INBOUND,
      // Only threads[0] is the message that just arrived; the quoted history
      // behind it already has its attachments on its own rows.
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
 * Stores the message's attachments and links them to the file.
 *
 * The documents hang off the engagement rather than off the outreach, which is
 * the point of the whole arrangement: a survey is a document on the compliance
 * file that happened to arrive from the surveyor, and the certifier is sent the
 * same row later. Only the mail is filed per party.
 *
 * Never throws. The email is already recorded, and losing an attachment is a
 * smaller failure than losing the fact that the surveyor replied.
 */
async function archiveAttachments(
  outreachId: string,
  engagementId: string,
  projectId: string,
  messageId: string,
  report: LeadAttachmentReport,
): Promise<
  { documentId: string; fileId: string; name: string; url: string }[]
> {
  "use step";

  if (report.files.length === 0) {
    return [];
  }

  // File.uploadedBy is a required relation, but nobody uploaded these — they
  // arrived on an email. An admin is the closest real actor the schema allows.
  const [uploadedBy] = await getAllAdminUsersIds();
  if (!uploadedBy) {
    console.error(
      `  No admin user to attribute ${report.files.length} party attachment(s) to; leaving them unsaved.`,
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
      const fileId = deterministicFileId(outreachId, file.id);

      const existing = await prisma.file.findUnique({
        where: { id: fileId },
        select: {
          id: true,
          url: true,
          filename: true,
          complianceDocumentId: true,
        },
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
        // Filed under the project, like every other file on the job: the vault
        // and the blob-cleanup cron both key on projects/<id>/.
        buildBlobPath({ fileId, fileName: file.name, projectId }),
        data,
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: file.mediaType,
        },
      );

      // RECEIVED, not UPLOADED: this arrived on an email rather than being put
      // there by an admin. UNKNOWN until the classifier runs — the row exists
      // first so a classification failure still leaves the document visible.
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
      console.error(
        `  Failed to archive party attachment "${file.name}":`,
        error,
      );
    }
  }

  return stored;
}

/**
 * Labels each stored attachment, within what this party can legitimately send.
 *
 * The narrowing is the whole point and it is per party rather than fixed: a
 * surveyor does not send architectural plans, and a classifier that reads a
 * site plan on a surveyor's covering email as the preliminary architectural set
 * would overwrite a document that has to come from somebody else. Anything
 * outside the party's set is left UNKNOWN for an admin to place by hand, which
 * is the same answer the certifier path gives.
 *
 * Placing a document replaces whatever the category held, for the reason
 * `placeInboundDocument` exists: a surveyor re-issuing a corrected survey on
 * the same thread means the second one is the survey from that moment on.
 */
async function classifyStoredDocuments(
  engagementId: string,
  party: CompliancePartyType,
  stored: { documentId: string; name: string; url: string }[],
): Promise<number> {
  "use step";

  const allowed = new Set<ComplianceDocumentType>(
    PARTY_INBOUND_DOCUMENT_TYPES[party],
  );
  let labelled = 0;

  for (const item of stored) {
    try {
      const result = await classifyDocumentAtUrl(item.url, item.name);
      if (
        result.documentType === ComplianceDocumentType.UNKNOWN ||
        !allowed.has(result.documentType)
      ) {
        console.log(`  "${item.name}" left unclassified: ${result.message}`);
        continue;
      }

      const placed = await placeInboundDocument({
        engagementId,
        documentId: item.documentId,
        documentType: result.documentType,
      });
      if (!placed.documentId) {
        // A retry that has already been through this one.
        continue;
      }

      // Only the blobs no email links at — the copy this replaced arrived as an
      // attachment on an earlier message, and that bubble still has to open it.
      await discardSupersededFiles(engagementId, placed.superseded);
      labelled += 1;
    } catch (error) {
      console.error(`  Failed to classify "${item.name}":`, error);
    }
  }

  return labelled;
}

/**
 * Reads the message for conditions that change the rest of the file.
 *
 * Its own step so a model failure retries on its own and cannot cost the
 * documents, which are already stored and classified by the time this runs.
 */
async function raiseAlertsFromMessage(
  params: {
    projectId: string;
    engagementId: string;
    party: CompliancePartyType;
  },
  message: InboundPartyMessage,
): Promise<number> {
  "use step";

  const detected = await detectComplianceAlerts({
    party: params.party,
    subject: message.subject,
    body: message.body,
  });

  let raised = 0;
  for (const alert of detected) {
    const result = await raiseComplianceAlert({
      projectId: params.projectId,
      engagementId: params.engagementId,
      type: alert.type,
      raisedByParty: params.party,
      detail: alert.detail,
    });
    // Only a new one counts. The same sentence quoted on three consecutive
    // replies is one condition, and `raiseComplianceAlert` already collapses
    // them onto the row that is open.
    if (result.created) raised += 1;
  }

  return raised;
}

/**
 * Stamps the reply-to id, moves the outreach forward, and tells the admins.
 *
 * The message id is stamped unconditionally and outside the status guard: a
 * second reply on an outreach that has already moved still has to become the
 * message the next reply threads onto, or the conversation forks off the
 * latest turn.
 */
async function advanceAndNotify(
  outreach: {
    id: string;
    party: CompliancePartyType;
    engagementId: string;
    projectId: string;
  },
  message: InboundPartyMessage,
  documentCount: number,
): Promise<void> {
  "use step";

  await prisma.complianceOutreach.update({
    where: { id: outreach.id },
    data: { lastInboundMessageId: message.messageId },
  });

  await prisma.complianceOutreach.updateMany({
    where: {
      id: outreach.id,
      status: {
        in: [ComplianceOutreachStatus.NOT_SENT, ComplianceOutreachStatus.SENT],
      },
    },
    data: { status: ComplianceOutreachStatus.RESPONSE_RECEIVED },
  });

  await logAction(
    createActivityLogEntry("complianceOutreachResponseReceived", {
      projectId: outreach.projectId,
      engagementId: outreach.engagementId,
      outreachId: outreach.id,
      party: outreach.party,
      emailFrom: message.from,
      subject: message.subject,
      attachmentCount: documentCount,
    }),
  );

  await notifyCompliance(
    "complianceOutreachResponseReceived",
    outreach.projectId,
    {
      party: PARTY_LABEL[outreach.party],
      attachmentCount: documentCount,
    },
  );
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Turns one inbound surveyor, architect or council email into recorded
 * documents and, where the message says so, an alert.
 *
 * The half of the webhook that cannot afford to run inline, for the reason the
 * certifier workflow spells out: Graph is told 202 before any of it starts, so
 * a timeout downloading a survey set or a rate-limited classification would
 * lose the reply with no trace and no second attempt.
 *
 * The caller has already found the token in the subject and rejected bounces
 * and auto-replies.
 */
export const processInboundPartyEmail = async (
  message: InboundPartyMessage,
): Promise<InboundPartyOutcome> => {
  "use workflow";

  if (!message.messageId) {
    // Nothing downstream can be made idempotent without it.
    throw new FatalError("processInboundPartyEmail requires a messageId.");
  }

  const outreach = await findOutreach(message.refToken);
  if (!outreach) {
    console.log(
      `  No compliance outreach for token ${message.refToken}; ignoring message ${message.messageId}.`,
    );
    return { status: "no-matching-outreach" };
  }

  const projectId = outreach.engagement.projectId;

  const report = await readAttachments(message.messageId);
  const stored = await archiveAttachments(
    outreach.id,
    outreach.engagementId,
    projectId,
    message.messageId,
    report,
  );

  await saveInboundEmails(
    outreach.engagementId,
    outreach.id,
    message,
    stored.map((item) => ({ name: item.name, url: item.url })),
  );

  if (stored.length > 0) {
    const labelled = await classifyStoredDocuments(
      outreach.engagementId,
      outreach.party,
      stored,
    );
    console.log(
      `  Classified ${labelled} of ${stored.length} ${outreach.party.toLowerCase()} document(s).`,
    );
  }

  const alerts = await raiseAlertsFromMessage(
    {
      projectId,
      engagementId: outreach.engagementId,
      party: outreach.party,
    },
    message,
  );

  await advanceAndNotify(
    {
      id: outreach.id,
      party: outreach.party,
      engagementId: outreach.engagementId,
      projectId,
    },
    message,
    stored.length,
  );

  return {
    status: "recorded",
    outreachId: outreach.id,
    party: outreach.party,
    documents: stored.length,
    alerts,
  };
};
