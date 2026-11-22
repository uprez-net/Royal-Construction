import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { createHash } from "node:crypto";

import {
  CertifierEngagementStatus,
  ComplianceAlertSource,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  GraphMailbox,
} from "@prisma/client";
import { put } from "@/lib/blob";
import { FatalError } from "workflow";

import { readAssessorCorrespondence } from "@/lib/agent/assessorCorrespondenceAgent";
import { detectComplianceAlerts } from "@/lib/agent/complianceAlertAgent";
import { applyAssessorCorrespondence } from "@/lib/data/compliance-issued-items";
import {
  closeComplianceIfComplete,
  recordCertificateIssued,
} from "@/lib/data/compliance-certificate";
import { isCertificateDocument } from "@/lib/domain/compliance/portal-certificates";
import { classifyDocumentAtUrl } from "@/lib/agent/documentClassifierAgent";
import { raiseComplianceAlert } from "@/lib/data/compliance-alerts";
import {
  discardSupersededFiles,
  placeInboundDocument,
} from "@/lib/compliance/document-replacement";
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
import { buildInboundCertifierRows } from "@/lib/compliance/inbound-rows";
import { buildBlobPath } from "@/utils/formatters";
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
  | {
      status: "recorded";
      engagementId: string;
      documents: number;
      /** Conditions the reply raised — a DA requirement, today. */
      alerts: number;
    }
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
  // Either certificate, where the certifier sends it rather than leaving it on
  // the portal for us to fetch.
  //
  // Not the ordinary route and kept here because of how much the exception
  // costs. The certificate is determined on the NSW Planning Portal and
  // downloaded from it, so the normal path is an upload by hand and the
  // classifier never sees one. But a certifier who has just determined an
  // application routinely forwards it on this thread as a courtesy — and since
  // this is the document that ends the compliance file, leaving it unclassified
  // would strand a finished job one step from done with its certificate sitting
  // in the needs-identifying queue.
  ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
  ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE,
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
async function graphClient(mailbox: GraphMailbox) {
  return createGraphContext(
    getGraphConfig(mailbox === GraphMailbox.ADMIN ? "admin" : "business"),
  );
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
function deterministicFileId(
  engagementId: string,
  attachmentId: string,
): string {
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
    select: {
      id: true,
      projectId: true,
      subjectAddress: true,
      graphMailbox: true,
    },
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
async function readAttachments(
  messageId: string,
  mailbox: GraphMailbox,
): Promise<LeadAttachmentReport> {
  "use step";
  const client = await graphClient(mailbox);
  const report = await collectLeadAttachments(client, messageId);

  if (report.names.length > 0) {
    console.log(
      `  Certifier attachments on ${messageId}: ${report.files.length} read, `
        + `${report.skipped.length} skipped`
        + (report.skipped.length > 0
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
  graphMailbox: GraphMailbox,
): Promise<number> {
  "use step";

  const sentAt = parseEmailDate(message.receivedDateTime) ?? new Date();
  const threads = getAllEmailThreads(message.body, {
    from: message.from,
    to: message.to,
    subject: message.subject,
    sentAt: message.receivedDateTime,
  });

  const rows = await buildInboundCertifierRows({
    attachments,
    engagementId,
    fallback: { sentAt, subject: message.subject, from: message.from, to: message.to },
    graphMailbox,
    threads,
  });

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
  mailbox: GraphMailbox,
): Promise<
  { documentId: string; fileId: string; name: string; url: string }[]
> {
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

  const client = await graphClient(mailbox);
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
          tags: ["Compliance", "Received by email", "Certifier reply"],
          origin: "Email › Certifier reply",
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
        `  Failed to archive certifier attachment "${file.name}":`,
        error,
      );
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
 *
 * Placing a document replaces whatever the category was holding. A certifier
 * sends a fee proposal, it gets discussed on the phone, and a revised one comes
 * back on the same thread — the second is the fee proposal from that moment on,
 * and stamping a type on it while the first kept its row left the engagement
 * with two, the tab reading the older of them, and the outdated copy following
 * the job through to the finished file.
 */
async function classifyStoredDocuments(
  engagementId: string,
  stored: { documentId: string; name: string; url: string }[],
): Promise<{
  labelled: number;
  checklistDocumentId: string | null;
  certificateArrived: boolean;
}> {
  "use step";

  let labelled = 0;
  let checklistDocumentId: string | null = null;
  // The end of the file. Reported back so the workflow can move the engagement
  // and open the insurance step, which is a write against other rows and
  // belongs in its own retryable step rather than in the middle of a loop that
  // is still classifying attachments.
  let certificateArrived = false;

  for (const item of stored) {
    try {
      const result = await classifyDocumentAtUrl(item.url, item.name);
      if (
        result.documentType === ComplianceDocumentType.UNKNOWN
        || !INBOUND_CLASSIFIABLE.has(result.documentType)
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

      // The blobs are reclaimed here rather than left to the cleanup, but only
      // ever the ones no email links at — the copy this replaced arrived as an
      // attachment on an earlier message, and that bubble still has to open it.
      await discardSupersededFiles(engagementId, placed.superseded);
      if (placed.superseded.length > 0) {
        console.log(
          `  "${item.name}" replaced ${placed.superseded.length} superseded ${result.documentType} file(s).`,
        );
      }
      labelled += 1;

      // Reported back so the notification can offer to run the extraction, and
      // it is the surviving row that is reported — a revised checklist has to
      // be extracted over the document everything else already points at. A
      // certifier who attaches two checklists is answered with the first.
      if (
        result.documentType === ComplianceDocumentType.CHECKLIST
        && !checklistDocumentId
      ) {
        checklistDocumentId = placed.documentId;
      }

      // Either certificate counts. Read through `isCertificateDocument` rather
      // than compared against one type, because which of the two a file ends on
      // depends on the route it took and this workflow has no business knowing
      // which — see `certificateKindFor`.
      if (isCertificateDocument(result.documentType)) {
        certificateArrived = true;
      }
    } catch (error) {
      console.error(`  Failed to classify "${item.name}":`, error);
    }
  }

  return { labelled, checklistDocumentId, certificateArrived };
}

/**
 * Reads the certifier's reply for conditions that reshape the file.
 *
 * One today, and it is the certifier's to raise as much as the architect's: a
 * proposal that falls outside complying development needs a DA, and the
 * certifier is who actually decides that. Very often they are the first to say
 * it, because the architect did not spot it — which is exactly the case worth
 * catching automatically, since nothing else in this workflow reads the body at
 * all and it would otherwise sit in the thread until somebody opened it.
 *
 * Its own step so a model failure retries on its own and cannot cost the
 * documents, which are already stored and classified by the time this runs.
 */
async function raiseAlertsFromCertifierMessage(
  engagement: { id: string; projectId: string },
  message: InboundCertifierMessage,
): Promise<number> {
  "use step";

  const detected = await detectComplianceAlerts({
    source: ComplianceAlertSource.CERTIFIER,
    subject: message.subject,
    body: message.body,
  });

  let raised = 0;
  for (const alert of detected) {
    const result = await raiseComplianceAlert({
      projectId: engagement.projectId,
      engagementId: engagement.id,
      type: alert.type,
      raisedBySource: ComplianceAlertSource.CERTIFIER,
      detail: alert.detail,
    });
    // Only a new one counts. The architect may already have said the same
    // thing, and `raiseComplianceAlert` collapses both onto the row that is
    // open — one condition, however many people report it.
    if (result.created) raised += 1;
  }

  return raised;
}

/**
 * Reads the certifier's reply for what they have sent back off their checklist.
 *
 * The counterpart to the council branch in lib/workflow/party-email.ts, reading
 * the same three things with the same extraction. A certifier reviewing the
 * evidence sent against their checklist says "item 7 will not do, the BASIX
 * certificate has expired" in prose, and before this the only record that they
 * had was the email — an admin had to read it and press Reject on each row.
 *
 * That button is still there and is still the better path when somebody is
 * watching. This is for the reply that lands overnight, and for the certifier
 * who sends back four items in one message.
 *
 * Its own step so a model failure retries alone, and idempotent underneath: a
 * rejection already on the row it names changes nothing, so a retry after a
 * partial run finishes rather than duplicating.
 */
async function recordCertifierVerdicts(
  engagement: { id: string; projectId: string },
  message: InboundCertifierMessage,
): Promise<{ created: number; rejected: number }> {
  "use step";

  const correspondence = await readAssessorCorrespondence({
    assessor: "certifier",
    subject: message.subject,
    body: message.body,
  });

  if (
    correspondence.requested.length === 0
    && correspondence.rejected.length === 0
  ) {
    return { created: 0, rejected: 0 };
  }

  const outcome = await applyAssessorCorrespondence({
    projectId: engagement.projectId,
    engagementId: engagement.id,
    assessor: "certifier",
    requested: correspondence.requested,
    rejected: correspondence.rejected,
  });

  if (outcome.unmatched.length > 0) {
    console.log(
      `  Certifier rejection(s) with no matching checklist row: ${outcome.unmatched.join(", ")}`,
    );
  }

  return { created: outcome.created, rejected: outcome.rejected };
}

/**
 * Moves the engagement on when the construction certificate arrives.
 *
 * Its own step because it is a write against the engagement rather than against
 * the documents, and because what it opens -- the insurance question -- is the
 * last thing anybody has to do on this file. A classification that succeeded
 * and a status move that did not would leave the certificate on the row with
 * the tab still showing a checklist nobody can act on.
 */
async function closeOutCertificate(engagement: {
  id: string;
  projectId: string;
}): Promise<void> {
  "use step";
  await recordCertificateIssued(engagement);
  await closeComplianceIfComplete({
    projectId: engagement.projectId,
    engagementId: engagement.id,
  });
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
  try {
    return await runProcessInboundCertifierEmail(message);
  } catch (error) {
    await reportWorkflowError("processInboundCertifierEmail", error);
    throw error;
  }
};

// The body, split out so the workflow function above can report a run that
// fails once its steps are out of retries. A plain function: it runs in the
// same sandbox and calls its steps exactly as before.
const runProcessInboundCertifierEmail = async (
  message: InboundCertifierMessage,
): Promise<InboundCertifierOutcome> => {
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

  const report = await readAttachments(
    message.messageId,
    engagement.graphMailbox,
  );
  const stored = await archiveAttachments(
    engagement.id,
    engagement.projectId,
    message.messageId,
    report,
    engagement.graphMailbox,
  );

  await saveInboundEmails(
    engagement.id,
    message,
    stored.map((item) => ({ name: item.name, url: item.url })),
    engagement.graphMailbox,
  );

  let checklistDocumentId: string | null = null;
  if (stored.length > 0) {
    const classification = await classifyStoredDocuments(engagement.id, stored);
    checklistDocumentId = classification.checklistDocumentId;
    console.log(
      `  Classified ${classification.labelled} of ${stored.length} certifier document(s).`,
    );

    if (classification.certificateArrived) {
      await closeOutCertificate(engagement);
    }
  }

  // What they sent back off their own checklist. After the documents, because
  // a reply that both encloses a revised checklist and rejects two items should
  // have the checklist in place before the rejections look for their rows.
  const verdicts = await recordCertifierVerdicts(engagement, message);
  if (verdicts.created > 0 || verdicts.rejected > 0) {
    console.log(
      `  Certifier asked for ${verdicts.created} more document(s) and sent back ${verdicts.rejected}.`,
    );
  }

  const alerts = await raiseAlertsFromCertifierMessage(engagement, message);

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
    alerts,
  };
};
