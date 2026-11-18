import "server-only";

import {
  ComplianceAlertType,
  CertifierEmailDirection,
  CertifierEngagementStatus,
  GraphMailbox,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  Role,
  Prisma,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  complianceDocumentLabel,
  isCertifierResponseType,
  isIdentifiableDocumentType,
  isNotRequired,
  isOutstandingEvidence,
  isReviewSubmissionType,
  REQUIRED_COMPLIANCE_DOCUMENTS,
  SIGNED_COPY_DOCUMENTS,
} from "@/constants/complianceDocuments";
import {
  buildCertifierReplySubject,
  buildCertifierSubject,
} from "@/lib/graph/certifier-subject";
import { createGraphContext, type EmailAttachment } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import {
  discardSupersededFiles,
  placeInboundDocument,
} from "@/lib/compliance/document-replacement";
import {
  applicableRequiredDocuments,
  canSendRequiredPack,
  hasSentCurrentDocument,
  hasSentRequiredPack,
  missingOutreachDocuments,
  sentToCertifierUrls,
  unsentRequiredDocuments,
} from "@/lib/domain/compliance/required-pack";
import { packSendBlockedReason } from "@/lib/domain/compliance/prerequisites";
import { certifierCopyAddresses } from "@/lib/domain/compliance/certifier-copies";
import { earlyReviewSelection } from "@/lib/domain/compliance/early-review";
import {
  recordPreliminaryPlansArrival,
  recordWasteManagementPlanArrival,
} from "@/lib/data/compliance-architect";
import { recordExternalApplicationArrival } from "@/lib/data/compliance-applications";
import {
  recordArchitecturalDesignRevisionArrival,
  recordEstateDeveloperFromDeed,
} from "@/lib/data/compliance-developer";
import {
  closeComplianceIfComplete,
  recordCertificateIssued,
} from "@/lib/data/compliance-certificate";
import { fillChecklistLinesFor } from "@/lib/compliance/checklist-mapping";
import { isCertificateDocument } from "@/lib/domain/compliance/portal-certificates";
import { recordHomeInsuranceOnProject } from "@/lib/compliance/home-insurance";
import { verifyTitleSearchOwners } from "@/lib/compliance/verify-title-search";
import { notifyCompliance } from "@/lib/compliance/notify";
import prisma from "@/lib/prisma";
import { resolveComplianceDocument as resolveComplianceDocumentDomain } from "@/lib/domain/compliance/documents";
import { setComplianceDocumentNotRequired as setComplianceDocumentNotRequiredDomain } from "@/lib/domain/compliance/documents";
import { ensureDevelopmentApplicationDocuments as ensureDevelopmentApplicationDocumentsDomain } from "@/lib/domain/compliance/documents";
import { startComplianceEngagement } from "@/lib/domain/compliance/engagements";
import {
  activateAfterPriorCompliance,
  openPriorComplianceFile,
} from "@/lib/domain/compliance/prior-compliance";
import type { PriorComplianceDocumentType } from "@/lib/domain/compliance/recorded-outside";
import { dismissUnidentifiedComplianceDocument } from "@/lib/domain/compliance/dismiss-arrival";
import { vercelBlobDelete } from "@/lib/blob-port";
import { userPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  checklistBlockedReason,
  type CertifierEmailAttachment,
  type CertifierEngagementDetail,
} from "@/types/compliance";
import { normalizeEmailAddress } from "@/utils/formatters";
import { generateEmailChecksum } from "@/utils/generator";
import type {
  CertifierReplyAttachment,
  StartEngagementInput,
} from "@/utils/validators/compliance";
import { logAction } from "./actionLog";

const engagementInclude = certifierEngagementInclude;

/**
 * Ensures every fixed DA row exists once the DA path is opened.
 *
 * Most of these rows do not have a file yet, but they still need an identity so
 * an admin can explicitly say that a conditional council requirement does not
 * apply. Uploading used to create those rows lazily; the not-required action
 * needs the row before an upload, so the DA alert seeds the fixed list.
 */
export async function ensureDevelopmentApplicationDocuments(
  engagementId: string,
): Promise<boolean> {
  return ensureDevelopmentApplicationDocumentsDomain(engagementId, prisma);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getCertifierEngagement(
  projectId: string,
): Promise<CertifierEngagementDetail | null> {
  const engagement = await prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: engagementInclude,
  });

  if (!engagement) return null;

  const hasDevelopmentApplication =
    engagement.alerts.some(
      (alert) =>
        alert.type === ComplianceAlertType.DA_APPROVAL_REQUIRED
        && alert.status === "OPEN",
    )
    || engagement.externalApplications.some(
      (application) =>
        application.kind
        === ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
    );

  if (
    !hasDevelopmentApplication
    || !(await ensureDevelopmentApplicationDocuments(engagement.id))
  ) {
    return engagement;
  }

  return prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: engagementInclude,
  });
}

/**
 * The engagement, or a throw.
 *
 * Every caller below acts on an engagement the UI has already rendered, so its
 * absence is a bug rather than a branch worth handling twice over.
 */
async function requireEngagement(
  engagementId: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await prisma.certifierEngagement.findUnique({
    where: { id: engagementId },
    include: engagementInclude,
  });
  if (!engagement) {
    throw new Error(`Certifier engagement ${engagementId} not found.`);
  }
  return engagement;
}

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`certifier-engagement-${projectId}`, CACHE_PROFILES.SHORT);
}

// ---------------------------------------------------------------------------
// Engagement lifecycle
// ---------------------------------------------------------------------------

/**
 * Opens the engagement and seeds one PENDING row per required document.
 *
 * The six rows are created up front rather than on first upload, so the tab has
 * something to render immediately and discovery has a row to attach a found
 * file to instead of inventing one mid-loop.
 *
 * Idempotent through the unique `projectId`: a double-click returns the
 * engagement that already exists rather than failing on the constraint.
 */
export async function startCertifierEngagement(
  principal: DomainPrincipal,
  projectId: string,
  input: StartEngagementInput,
): Promise<CertifierEngagementDetail> {
  const { engagement } = await startComplianceEngagement(
    principal,
    { projectId, ...input },
    prisma,
  );

  after(async () => {
    revalidateEngagement(projectId);
  });

  return engagement;
}

/**
 * Files one document of compliance done before the CRM, and moves the job to
 * ACTIVE once its certificate and HBCF cover are both held.
 *
 * Three steps, in this order: open (or reuse) the no-certifier file, attach
 * the upload through the same `attachComplianceDocumentFile` every other
 * compliance upload uses — so a replaced copy is reclaimed, the upload is
 * logged and an HBCF certificate is mirrored onto the Overview — and then ask
 * whether the job is now complete. The rules are in `prior-compliance.ts`.
 */
export async function recordPriorComplianceDocument(
  principal: DomainPrincipal,
  input: {
    projectId: string;
    documentType: PriorComplianceDocumentType;
    fileId: string;
  },
) {
  const { engagementId } = await openPriorComplianceFile(
    principal,
    { projectId: input.projectId },
    prisma,
  );
  await attachComplianceDocumentFile({
    engagementId,
    projectId: input.projectId,
    documentType: input.documentType,
    fileId: input.fileId,
  });
  const outcome = await activateAfterPriorCompliance(
    principal,
    { projectId: input.projectId },
    prisma,
  );

  after(async () => {
    revalidateEngagement(input.projectId);
  });

  return outcome;
}

/**
 * Moves the engagement forward, guarded on the statuses it is legal to leave.
 *
 * Two tabs racing the same transition produce one move and one no-op rather
 * than a status that goes backwards. Returns whether this call was the mover.
 */
export async function advanceEngagementStatus(
  engagementId: string,
  from: CertifierEngagementStatus[],
  to: CertifierEngagementStatus,
): Promise<boolean> {
  const claim = await prisma.certifierEngagement.updateMany({
    where: { id: engagementId, status: { in: from } },
    data: { status: to },
  });
  return claim.count === 1;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Reads a blob back into the base64 Graph wants.
 *
 * The bytes are fetched here, at send time, rather than carried around: blob
 * storage is already durable, and a document pack runs to tens of megabytes
 * that have no business sitting in memory — or in a workflow event log — any
 * longer than the single request that sends them.
 */
async function toEmailAttachment(file: {
  url: string;
  filename: string;
  fileType: string;
}): Promise<EmailAttachment> {
  const response = await fetch(file.url);
  if (!response.ok) {
    throw new Error(
      `Could not read "${file.filename}" back from storage (${response.status}).`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    name: file.filename,
    contentType: file.fileType || "application/octet-stream",
    contentBytes: bytes.toString("base64"),
  };
}

/**
 * Records a message this system sent.
 *
 * Uses the same checksum key as the inbound path, so an outbound copy that
 * comes back around through the mailbox subscription lands on the row already
 * here instead of duplicating the bubble.
 */
async function recordOutboundEmail(params: {
  engagementId: string;
  emailFrom: string;
  emailTo: string;
  subject: string;
  body: string;
  attachments: CertifierEmailAttachment[];
  graphMailbox: GraphMailbox;
}): Promise<void> {
  const checksum = await generateEmailChecksum(
    params.subject,
    params.body,
    params.emailFrom,
    params.emailTo,
  );

  await prisma.certifierEmail.createMany({
    data: [
      {
        engagementId: params.engagementId,
        emailFrom: normalizeEmailAddress(params.emailFrom),
        emailTo: normalizeEmailAddress(params.emailTo),
        subject: params.subject,
        body: params.body,
        checksum,
        direction: CertifierEmailDirection.OUTBOUND,
        graphMailbox: params.graphMailbox,
        attachments: params.attachments as unknown as Prisma.InputJsonValue,
        sentAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * The outreach body.
 *
 * Plain and short on purpose: everything the certifier needs is attached and
 * the subject already carries the address. Deliberately not a React-Email
 * template like the customer-facing mail — there is no branding to render and
 * no link to track here, and a template would only bury the reference line the
 * whole correlation depends on.
 */
function outreachBody(
  certifierName: string | null,
  subjectAddress: string,
  /**
   * Documents the pack is going out without.
   *
   * Only ever the ones the send does not wait for. Named in the mail rather
   * than left out silently: a certifier who can see the full design is coming
   * assesses the CDC pathway off what is attached and says so, while one who
   * simply finds it absent assumes the pack is incomplete and waits for it.
   */
  pending: readonly string[],
): string {
  const greeting = certifierName ? `Hi ${certifierName},` : "Hi,";
  return [
    `<p>${greeting}</p>`,
    `<p>Please find attached the documentation for <strong>${subjectAddress}</strong>.</p>`,
    pending.length > 0
      ? `<p>${listSentence(pending)} ${pending.length === 1 ? "is" : "are"} still being finalised. Could you confirm whether the proposal can proceed as a CDC on what is attached, and let us know anything further you need?</p>`
      : "",
    "<p>Could you send through your fee proposal, the CDC application form and your document checklist when you have a moment?</p>",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Sends the required document pack to the certifier and opens the thread.
 *
 * The subject carries the engagement's `refToken`, which is the only thing
 * tying every later reply back to this project.
 *
 * Attachment limits are not re-implemented here. `sendMail` asserts the total
 * against the mailbox's Exchange `MaxSendSize` before it sends anything, and
 * throws naming both figures; it also switches to the draft plus upload-session
 * path on its own past the 3 MB inline ceiling. That error is left to propagate
 * so the UI shows what Exchange will actually refuse, rather than a second
 * guess at the limit that could quietly disagree with it.
 */
export async function sendCertifierOutreach(engagementId: string) {
  const engagement = await requireEngagement(engagementId);
  const certifierEmail = engagement.certifierEmail;

  if (!certifierEmail) {
    throw new Error("This engagement has no certifier email address.");
  }

  // Measured against the outreach set rather than the whole pack. The full
  // architectural design is what the job is built from, not what it is assessed
  // on, so a certifier can be asked whether the proposal qualifies as complying
  // development without it -- and holding the send until it existed meant the
  // one question worth asking early was the last one asked. The same reading
  // the tab's send button takes, so the two cannot disagree about what is
  // missing.
  const missing = missingOutreachDocuments(engagement);
  if (missing.length > 0) {
    throw new Error(
      `Still missing ${missing.map((doc) => doc.label).join(", ")}.`,
    );
  }

  // Checked after the missing-document test and before anything is read out of
  // storage. These are the conditions where every row is full and the pack must
  // still not go -- a title search naming the previous owners, or plans the
  // client has not approved. Same function the tab disables the button with, so
  // the refusal here is the sentence already on screen rather than a second
  // account of it.
  const blocked = packSendBlockedReason(engagement);
  if (blocked) {
    throw new Error(blocked);
  }

  // Wanted on the file, not attached to this send. Named in the mail so the
  // certifier reads the pack as deliberately partial rather than incomplete.
  const pending = applicableRequiredDocuments(engagement)
    .filter(
      (required) =>
        !engagement.documents.some(
          (document) =>
            document.documentType === required.type
            && document.files.length > 0,
        ),
    )
    .map((required) => required.label);

  const requiredTypes = new Set<ComplianceDocumentType>(
    REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => doc.type),
  );
  const files = engagement.documents
    .filter((doc) => requiredTypes.has(doc.documentType))
    .flatMap((doc) => doc.files);

  // The pack has already gone once, and something on it has since been
  // replaced — the tab offers the send again for exactly that. It cannot be
  // the same act twice over: a second outreach would open a thread beside the
  // one already running, re-attach documents the certifier has had for weeks,
  // and carry the same subject and body as the first, which collides on
  // checksum so the resend would not even be recorded. It rides the existing
  // thread instead, carrying only what they have not been sent.
  if (hasSentRequiredPack(engagement)) {
    return sendUpdatedRequiredDocuments(engagement);
  }

  const config = getGraphConfig(
    engagement.graphMailbox === GraphMailbox.ADMIN ? "admin" : "business",
  );
  const client = await createGraphContext(config);
  const subject = buildCertifierSubject(
    engagement.refToken,
    engagement.subjectAddress,
  );
  const body = outreachBody(
    engagement.certifierName,
    engagement.subjectAddress,
    pending,
  );
  const attachments = await Promise.all(files.map(toEmailAttachment));
  const cc = await certifierCopyAddresses(certifierEmail, config.cc, prisma);

  await client.sendMail({
    to: certifierEmail,
    subject,
    body,
    cc,
    attachments,
  });

  await recordOutboundEmail({
    engagementId,
    graphMailbox: engagement.graphMailbox,
    emailFrom: config.senderUpn ?? "",
    emailTo: certifierEmail,
    subject,
    body,
    attachments: files.map((file) => ({ name: file.filename, url: file.url })),
  });

  await advanceEngagementStatus(
    engagementId,
    [
      CertifierEngagementStatus.NOT_STARTED,
      CertifierEngagementStatus.COLLECTING_DOCS,
    ],
    CertifierEngagementStatus.OUTREACH_SENT,
  );

  after(async () => {
    revalidateEngagement(engagement.projectId);
    await logAction(
      createActivityLogEntry("certifierOutreachSent", {
        projectId: engagement.projectId,
        engagementId,
        certifierEmail,
        refToken: engagement.refToken,
        documentCount: files.length,
      }),
    );
    await notifyCompliance("certifierOutreachSent", engagement.projectId, {
      certifierEmail,
      documentCount: files.length,
    });
  });

  return { subject, attachmentCount: files.length };
}

/**
 * Sends the required documents the certifier has not seen, on the open thread.
 *
 * "Not seen" is read off the mail trail rather than off a timestamp: every
 * outbound row records the blob URL of what it carried, so a file whose URL
 * appears on none of them is one that has never left the building. That is
 * exactly the set a replacement creates — the old copy's URL is on the
 * outreach, the new one's is nowhere — and it is the same test the Compliance
 * tab uses to decide whether to offer the send at all, so the button and the
 * message it triggers cannot disagree about what is outstanding.
 *
 * The status is left alone. The engagement is already past outreach and this
 * does not move it on; re-supplying a plan set is not a step of its own.
 */
async function sendUpdatedRequiredDocuments(
  engagement: CertifierEngagementDetail,
) {
  // The tab stops offering this at the same line, so reaching it here means a
  // stale page or a second tab that has not seen the checklist arrive.
  if (!canSendRequiredPack(engagement)) {
    throw new Error(
      "The certifier has issued their checklist, so the required pack is no longer part of the flow. Send the updated document on the thread instead.",
    );
  }

  const sentUrls = sentToCertifierUrls(engagement);
  const updated = unsentRequiredDocuments(engagement).map((doc) => ({
    label: complianceDocumentLabel(doc.documentType, doc.label),
    files: doc.files.filter((file) => !sentUrls.has(file.url)),
  }));

  if (updated.length === 0) {
    throw new Error(
      "The certifier already has the current copy of every required document.",
    );
  }

  const labels = updated.map((doc) => escapeEmailHtml(doc.label)).join(", ");

  return sendCertifierReply(engagement.id, {
    body: [
      "<p>Hi,</p>",
      `<p>An updated copy of the following for <strong>${escapeEmailHtml(
        engagement.subjectAddress,
      )}</strong> is attached: ${labels}.</p>`,
      "<p>Please use these in place of the versions sent earlier.</p>",
      "<p>Kind regards,<br/>Royal Constructions</p>",
    ].join("\n"),
    attachments: updated.flatMap((doc) =>
      doc.files.map((file) => ({
        fileId: file.id,
        name: file.filename,
        url: file.url,
      })),
    ),
  });
}

/**
 * Whether Graph answered "that message is not there".
 *
 * 404 is the only status that means the reply target itself is missing, as
 * opposed to the mailbox being unreachable or the send being refused — those
 * have to keep throwing, or a real outage would quietly fork every thread onto
 * a subject-only send.
 */
function isMissingGraphMessage(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 404;
}

/**
 * Replies on the existing thread.
 *
 * Used by the composer, by the signed-copy send and by the review send. All
 * three are the same act as far as the certifier is concerned — another message
 * on the thread they already have open — so they share one path and one audit
 * entry rather than being three near-copies that drift.
 */
export async function sendCertifierReply(
  engagementId: string,
  input: { body: string; attachments?: CertifierReplyAttachment[] },
) {
  const engagement = await requireEngagement(engagementId);
  const certifierEmail = engagement.certifierEmail;

  if (!certifierEmail) {
    throw new Error("This engagement has no certifier email address.");
  }

  const config = getGraphConfig(
    engagement.graphMailbox === GraphMailbox.ADMIN ? "admin" : "business",
  );
  const client = await createGraphContext(config);

  // Rebuilt from the engagement rather than taken from the last message on the
  // thread: a certifier who edits the subject must not be able to move the
  // conversation off its own token.
  const subject = buildCertifierReplySubject(
    buildCertifierSubject(engagement.refToken, engagement.subjectAddress),
  );

  const requested = input.attachments ?? [];
  const files = requested.length
    ? await prisma.file.findMany({
        where: { id: { in: requested.map((item) => item.fileId) } },
        select: { id: true, url: true, filename: true, fileType: true },
      })
    : [];

  const attachments = await Promise.all(files.map(toEmailAttachment));
  const cc = await certifierCopyAddresses(certifierEmail, config.cc, prisma);

  // Subject threading: what opens the thread before the certifier has answered,
  // and what is left if the message we were replying onto is gone.
  const sendOnSubject = () =>
    client.sendMail({
      to: certifierEmail,
      subject,
      body: input.body,
      cc,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

  if (engagement.lastInboundMessageId) {
    // A real reply: Graph builds it from the certifier's own message, so it
    // carries In-Reply-To, References and the conversation id, and lands in
    // their existing thread rather than beside it.
    try {
      await client.replyToMessage({
        messageId: engagement.lastInboundMessageId,
        body: input.body,
        to: certifierEmail,
        cc,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    } catch (error) {
      if (!isMissingGraphMessage(error)) {
        throw error;
      }
      // The id no longer resolves. Exchange mints a new one when a message is
      // moved, so filing the certifier's reply into a folder is enough to do
      // it, and deleting it certainly is. Without this the engagement is
      // wedged: every later send — the signed copies, the review pack, a
      // resupply notice — dies on a stale id with a perfectly good
      // subject-threaded path sitting right there.
      console.warn(
        `Certifier engagement ${engagementId}: reply target ${engagement.lastInboundMessageId} is gone; falling back to subject threading.`,
      );
      // Cleared so the next send goes straight down the fallback rather than
      // paying for the same 404 again. The certifier's next reply restores it.
      await prisma.certifierEngagement.update({
        where: { id: engagementId },
        data: { lastInboundMessageId: null },
      });
      await sendOnSubject();
    }
  } else {
    // Nothing to reply to yet — the certifier has not answered the outreach.
    await sendOnSubject();
  }

  await recordOutboundEmail({
    engagementId,
    graphMailbox: engagement.graphMailbox,
    emailFrom: config.senderUpn ?? "",
    emailTo: certifierEmail,
    subject,
    body: input.body,
    attachments: files.map((file) => ({ name: file.filename, url: file.url })),
  });

  after(async () => {
    revalidateEngagement(engagement.projectId);
    await logAction(
      createActivityLogEntry("certifierReplySent", {
        projectId: engagement.projectId,
        engagementId,
        certifierEmail,
        attachmentCount: files.length,
      }),
    );
  });

  return { subject, attachmentCount: files.length };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Attaches an already-uploaded file to a compliance document.
 *
 * `/api/upload` has already written the File row, so this only points it at the
 * document and moves the document's status on. Two acts, one transaction: a
 * document marked UPLOADED with no file behind it is what the review loop reads
 * as evidence, and it must never exist even briefly.
 *
 * When `documentType` names a type with no row yet — the two signed copies and
 * home insurance, which are not seeded at engagement start — the row is created
 * here.
 */
export async function attachComplianceDocumentFile(params: {
  engagementId: string;
  projectId: string;
  documentId?: string;
  documentType?: ComplianceDocumentType;
  fileId: string;
}) {
  const file = await prisma.file.findUnique({
    where: { id: params.fileId },
    // `url` is read for the re-supply email below, which attaches the
    // replacement rather than telling the certifier one exists somewhere.
    select: { id: true, filename: true, url: true },
  });
  if (!file) {
    throw new Error(`File ${params.fileId} not found.`);
  }

  const { document, sentBackFor, superseded } = await prisma.$transaction(
    async (tx) => {
      let target = params.documentId
        ? await tx.complianceDocument.findFirst({
            where: { id: params.documentId, engagementId: params.engagementId },
          })
        : params.documentType
          ? await tx.complianceDocument.findFirst({
              where: {
                engagementId: params.engagementId,
                documentType: params.documentType,
              },
              orderBy: { order: "asc" },
            })
          : null;

      if (!target) {
        if (!params.documentType) {
          throw new Error("No compliance document to attach this file to.");
        }
        // The signed copies and home insurance have no seeded row — they only
        // come into existence when someone uploads one.
        const nextOrder = await tx.complianceDocument.count({
          where: { engagementId: params.engagementId },
        });
        target = await tx.complianceDocument.create({
          data: {
            engagementId: params.engagementId,
            documentType: params.documentType,
            status: ComplianceDocumentStatus.PENDING,
            order: nextOrder,
          },
        });
      }

      // Every upload control on the tab is a single-file "Replace": one row
      // holds one document, not a growing pile of attempts at it. Appending
      // instead left the old copy attached — rendered on the row, offered to the
      // certifier by the next send, and counted by the vault — with its blob
      // never reclaimed. Read inside the transaction so the row cannot be left
      // pointing at two files even briefly.
      const superseded = await tx.file.findMany({
        where: { complianceDocumentId: target.id, id: { not: file.id } },
        select: { id: true, url: true },
      });

      if (superseded.length > 0) {
        await tx.file.deleteMany({
          where: { id: { in: superseded.map((stale) => stale.id) } },
        });
      }

      await tx.file.update({
        where: { id: file.id },
        data: { complianceDocumentId: target.id },
      });

      // Read before the update wipes it. A reason on the row means the certifier
      // sent this document back, and this upload is the answer to that — which is
      // both worth telling them about and impossible to know a moment later.
      const sentBackFor = target.rejectionReason;

      // Clearing rejectionReason is half the point of a re-upload: the document
      // is back in play, and leaving the old reason on it would keep showing why
      // the previous attempt failed as though it were still current.
      const document = await tx.complianceDocument.update({
        where: { id: target.id },
        data: {
          status: ComplianceDocumentStatus.UPLOADED,
          rejectionReason: null,
        },
      });

      return { document, sentBackFor, superseded };
    },
  );

  const documentLabel = complianceDocumentLabel(
    document.documentType,
    document.label,
  );

  // What the replacement pushed out. The rows are already gone; this is the
  // storage behind them, reclaimed after the response like every other
  // follow-on here.
  if (superseded.length > 0) {
    after(async () => {
      await discardSupersededFiles(params.engagementId, superseded);
    });
  }

  after(async () => {
    await logAction(
      createActivityLogEntry("complianceDocumentUploaded", {
        projectId: params.projectId,
        engagementId: params.engagementId,
        documentId: document.id,
        documentLabel,
        fileName: file.filename,
      }),
    );
  });

  // There is one home insurance certificate and two places that need it. The
  // Overview tab's HBCF block wants the number off it and a link to the file;
  // collecting it here used to leave that half untouched, so a project with the
  // certificate already in hand still read as missing its insurance number.
  if (document.documentType === ComplianceDocumentType.HOME_INSURANCE) {
    after(async () => {
      await recordHomeInsuranceOnProject({
        projectId: params.projectId,
        fileId: file.id,
      });
    });
  }

  // A revised set of plans answers the round of client revisions that asked for
  // it, and closes the two architect alerts. Fires on an admin's own upload as
  // well as on the inbound path, because an admin dragging in the set the
  // architect emailed them is the same event by a different route — and the
  // alert has to close either way, or the panel keeps chasing a redraw that is
  // sitting on the row underneath it.
  if (
    document.documentType
    === ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS
  ) {
    after(async () => {
      await recordPreliminaryPlansArrival({
        projectId: params.projectId,
        engagementId: params.engagementId,
      });
    });
  }

  if (
    document.documentType === ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN
  ) {
    after(async () => {
      await recordArchitecturalDesignRevisionArrival({
        projectId: params.projectId,
        engagementId: params.engagementId,
      });
    });
  }

  // A document arriving is what an application block's whole state machine is
  // waiting for, and an upload says so more strongly than the tick box does:
  // one is somebody reporting it, the other is somebody proving it. Without
  // this a certificate could sit on the file with an overdue alert still open
  // underneath it, because nobody went back to tick the box.
  //
  // Called for every upload rather than behind a type check, because the four
  // types this covers are a lookup inside it — the 10.7 certificate, the road
  // opening approval, the levy receipt and the mine subsidence approval — and
  // a condition here would be a fifth place to remember when a fifth
  // application is added.
  after(async () => {
    await recordExternalApplicationArrival({
      projectId: params.projectId,
      engagementId: params.engagementId,
      documentType: document.documentType,
    });
  });

  // The checklist lines asking for what just landed.
  //
  // Runs on every upload rather than behind a type check, because the set it
  // covers is a question for the mapper and a condition here would be a second
  // place to remember. The case it is really for is the development
  // application: a DA is assessed on very nearly the same evidence as a CDC, so
  // a structural drawing supplied on the DA list is the same drawing the
  // certifier asked for on their checklist, and collecting it twice is what
  // this stops. It also catches the ordinary case the extraction cannot — a
  // document that arrives weeks after the checklist was read.
  //
  // The revalidation rides on this callback rather than its own, and that is
  // the ordering that matters. `after()` callbacks run on a queue with no
  // concurrency limit, so a revalidation registered separately could — and did
  // — invalidate the cache before these rows were written, and the next read
  // repopulated it from a checklist that had not been filled in yet. The
  // upload then showed rows still asking for the document it had just supplied.
  //
  // In a `finally` so a mapping that throws still clears the cache. A stale
  // cache is the one failure here nobody can see or clear from the screen.
  after(async () => {
    try {
      await fillChecklistLinesFor({
        engagementId: params.engagementId,
        documentType: document.documentType,
      });
    } finally {
      revalidateEngagement(params.projectId);
    }
  });

  // The waste management plan is the architect's, on their existing thread, and
  // its clock is its own — so its alert closes on its own too. Nothing else the
  // architect sends answers it, and it answers nothing else of theirs.
  if (document.documentType === ComplianceDocumentType.WASTE_MANAGEMENT_PLAN) {
    after(async () => {
      await recordWasteManagementPlanArrival({
        projectId: params.projectId,
        engagementId: params.engagementId,
      });
    });
  }

  // The register lags settlement, so a title search can name the vendors --
  // and whoever supplied it has no way of knowing, because they never knew who
  // bought the place. Only we hold the contract that says whose job this is, so
  // the check runs here rather than waiting to be told. Fires on an admin's own
  // upload as well as on the inbound path: an admin dragging in the copy the
  // surveyor emailed them is the same document with the same problem.
  if (
    document.documentType
    === ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL
  ) {
    after(async () => {
      await verifyTitleSearchOwners({
        projectId: params.projectId,
        engagementId: params.engagementId,
        file: { url: file.url, filename: file.filename },
      });
    });
  }

  // The estate developer, read off the deed.
  //
  // The deed is the document that names whoever released the land, and it is
  // already here: it is uploaded so it can be sent to the surveyor, long before
  // anybody has to answer whether this lot carries a covenant. So the parse is
  // free in the sense that matters — no extra document is asked for — and it fills
  // in a question that otherwise has to be put to a person who may not know.
  //
  // `recordEstateDeveloperFromDeed` is the one that decides whether to look at
  // all: a file whose developer somebody has already answered for is skipped
  // there rather than here, because the skip has to hold on the inbound path too
  // and the condition belongs with the rule rather than with one of its callers.
  if (document.documentType === ComplianceDocumentType.LAND_DEED) {
    after(async () => {
      await recordEstateDeveloperFromDeed({
        projectId: params.projectId,
        engagementId: params.engagementId,
        file: { url: file.url, filename: file.filename },
      });
    });
  }

  // The certificate, put on the file by hand — which is now the ordinary route
  // rather than the exception.
  //
  // This branch was written for the certifier who posts the certificate or hands
  // it over at a site meeting, on the understanding that the inbound workflow
  // normally classified it off their reply. That is backwards: a CDC or a
  // construction certificate is determined on the NSW Planning Portal and
  // downloaded from it, so an upload is how it reaches the file nearly every
  // time, and the inbound path is the courtesy case.
  //
  // Either certificate, read through the one predicate that knows there are two.
  const isCertificate = isCertificateDocument(document.documentType);

  if (isCertificate) {
    // Chained rather than left to the queue. `after()` runs its callbacks with
    // no concurrency limit, so the close below could win the race: it would set
    // the engagement to COMPLETED first, `recordCertificateIssued` would
    // then update zero rows against its own status guard, and CERTIFICATE_ISSUED
    // — with its activity entry and its notification — would be skipped
    // entirely on the one upload that is supposed to produce it.
    after(async () => {
      await recordCertificateIssued({
        id: params.engagementId,
        projectId: params.projectId,
      });
      await closeComplianceIfComplete({
        projectId: params.projectId,
        engagementId: params.engagementId,
      });
    });
  } else {
    // Whether that was the last thing this file was waiting for.
    //
    // Run on every other upload rather than behind a type check, and it reads
    // both documents rather than trusting the one that triggered it. The
    // certificate and the HBCF cover arrive in either order — a builder who
    // raised the cover months ago has it on the file long before the certifier
    // issues anything — so "whichever lands last closes it" is the only rule
    // that works from both ends, and a condition here would have to encode
    // both. The certificate's own branch above runs the same check, after the
    // stage move it depends on.
    after(async () => {
      await closeComplianceIfComplete({
        projectId: params.projectId,
        engagementId: params.engagementId,
      });
    });
  }

  // A replacement for something the certifier sent back. They asked for a
  // change and have no way of knowing it has been made — the file just appears
  // on our side — so the upload is what tells them, quoting the reason back so
  // they can see it is the thing they asked for.
  if (sentBackFor) {
    after(async () => {
      await notifyCertifierOfResupply({
        engagementId: params.engagementId,
        documentLabel,
        rejectionReason: sentBackFor,
        file: { id: file.id, filename: file.filename, url: file.url },
      });
    });
  }

  return document;
}

/**
 * Escapes HTML-sensitive characters before a value goes into an email body.
 *
 * A rejection reason is typed by an admin and quoted straight back to the
 * certifier, so it is the one string on this thread that a person composes
 * freehand and a mail client renders as markup.
 */
function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Tells the certifier that something they rejected has been redone.
 *
 * Sent on the upload rather than waiting for another round of "send for
 * review": a rejection is a conversation the certifier started and is waiting
 * on, and holding the answer back until somebody remembers to press a button
 * leaves them looking at a file they think is still wrong.
 *
 * Never throws. The replacement is already stored and already visible in the
 * tab; a mailbox that is down is not a reason to fail an upload that worked.
 */
async function notifyCertifierOfResupply(params: {
  engagementId: string;
  documentLabel: string;
  rejectionReason: string;
  file: { id: string; filename: string; url: string };
}): Promise<void> {
  try {
    const engagement = await requireEngagement(params.engagementId);

    await sendCertifierReply(params.engagementId, {
      body: [
        "<p>Hi,</p>",
        `<p>You sent back <strong>${escapeEmailHtml(params.documentLabel)}</strong> for <strong>${escapeEmailHtml(engagement.subjectAddress)}</strong> with this note:</p>`,
        `<blockquote style="margin:0 0 1em;padding:0 0 0 1em;border-left:3px solid #ccc;">${escapeEmailHtml(params.rejectionReason)}</blockquote>`,
        "<p>That has been addressed and the replacement is attached. Could you take another look?</p>",
        "<p>Kind regards,<br/>Royal Constructions</p>",
      ].join("\n"),
      attachments: [
        {
          fileId: params.file.id,
          name: params.file.filename,
          url: params.file.url,
        },
      ],
    });
  } catch (error) {
    console.error(
      `Could not tell the certifier that "${params.documentLabel}" was re-supplied`,
      error,
    );
  }
}

/**
 * Approves or rejects one document.
 *
 * Follows handleAdminApproval: the caller has already been gated to ADMIN, the
 * cache invalidation is registered before the write, and the state change is a
 * status-guarded `updateMany` rather than an `update`.
 *
 * The guard is what makes two admins clicking at once safe — the second call
 * matches nothing and is a no-op instead of overwriting the first decision —
 * and it is also what stops an already-approved document being quietly
 * reopened from a stale tab.
 *
 * A rejection returns the document to PENDING rather than leaving it REJECTED:
 * the UI reads status to choose between an upload control and a decision pair,
 * and the reason it keeps is what tells the admin why they are uploading again.
 */
export async function resolveComplianceDocument(params: {
  projectId: string;
  documentId: string;
  decision: "approved" | "rejected";
  rejectionReason?: string;
  resolvedBy: string;
  /** The ADMIN the route already resolved through requireComplianceAdmin. */
  actor: { id: string; role: Role };
}) {
  // The decision itself is lib/domain/compliance/documents.ts, which Eve's
  // review tool now calls too — its own copy had no "has this been sent to the
  // certifier yet" check, so an agent could approve evidence nobody had asked
  // the certifier to look at.
  //
  // What stays here is everything that needs a request: the cache expiry, the
  // rejection notification, and the activity-log entries. `after` cannot run
  // outside one, which is why none of it could live in a shared module.
  after(() => revalidateEngagement(params.projectId));

  const outcome = await resolveComplianceDocumentDomain(
    userPrincipal(params.actor),
    params,
    prisma,
  );

  if (!outcome.resolved) {
    return { resolved: false as const, status: outcome.status };
  }

  if (!outcome.approved) {
    // Only the rejection is announced. Approving one of twenty checklist items
    // is not news; being told to redo one is.
    after(async () => {
      await notifyCompliance("complianceDocumentRejected", params.projectId, {
        documentLabel: outcome.documentLabel,
        rejectionReason: params.rejectionReason ?? "",
        resolvedBy: params.resolvedBy,
      });
    });
  }

  after(async () => {
    await logAction(
      outcome.approved
        ? createActivityLogEntry("complianceDocumentApproved", {
            projectId: params.projectId,
            engagementId: outcome.engagementId,
            documentId: outcome.documentId,
            documentLabel: outcome.documentLabel,
            resolvedBy: params.resolvedBy,
          })
        : createActivityLogEntry("complianceDocumentRejected", {
            projectId: params.projectId,
            engagementId: outcome.engagementId,
            documentId: outcome.documentId,
            documentLabel: outcome.documentLabel,
            resolvedBy: params.resolvedBy,
            rejectionReason: params.rejectionReason ?? "",
          }),
    );
  });

  // Announced only by the call that actually closed the engagement, so two
  // admins approving the last two documents at once do not both announce it.
  if (outcome.engagementClosed) {
    after(async () => {
      await notifyCompliance("complianceApproved", params.projectId, {});
    });
  }

  return { resolved: true as const, status: outcome.status };
}

/**
 * Marks a compliance document needed by the DA or checklist as not applying to
 * this job, or puts it back.
 *
 * The one judgement on a checklist row that nothing infers. A certifier's
 * checklist is a standard list sent for every job, so several lines routinely do
 * not apply to this one — they are struck through on the document, or they ask
 * for something the certifier already holds. Nothing in the pipeline can read a
 * strikethrough reliably, so the admin says so.
 *
 * DA rows are included because the council's standard list is conditional: a
 * document can be present in the list while not applying to this job. The
 * required pack and signed copies stay excluded; they are what opens the
 * engagement and cannot be waived through this control.
 *
 * Setting it never touches an uploaded file. A line can be marked not required
 * after something was uploaded against it — the certifier says they have it
 * after all — and the file stays where it is, so putting the row back restores
 * the evidence with it.
 */
export async function setComplianceDocumentNotRequired(params: {
  principal: DomainPrincipal;
  projectId: string;
  documentId: string;
  notRequired: boolean;
  resolvedBy: string;
}) {
  const outcome = await setComplianceDocumentNotRequiredDomain(
    params.principal,
    params,
    prisma,
  );

  after(() => revalidateEngagement(params.projectId));

  if (outcome.changed) {
    await logAction(
      createActivityLogEntry("complianceDocumentNotRequired", {
        projectId: params.projectId,
        engagementId: outcome.engagementId,
        documentId: outcome.documentId,
        documentLabel: outcome.documentLabel,
        resolvedBy: params.resolvedBy,
        notRequired: params.notRequired,
      }),
    );
  }

  return outcome;
}

/**
 * Sends a chosen set of checklist documents to the certifier in one email,
 * without waiting for the rest of the checklist.
 *
 * Independent of the engagement's IN_REVIEW status: the rest of the checklist
 * can still be collected while these items are assessed, and the outbound email
 * itself is the durable marker that enables their decision controls. A
 * replacement goes the same way, because its new URL is not on the mail trail
 * until this call succeeds.
 *
 * One email for the set rather than one per row: a certifier sent eight
 * documents as eight messages has eight threads of attachments to reconcile,
 * and the office had no way to send a partly complete pack as a pack. Which rows
 * may go is `earlyReviewSelection`'s decision, the same rule the tab reads to
 * offer a checkbox. Rows whose current copy the certifier already holds are left
 * off rather than attached again.
 */
export async function sendComplianceDocumentsForReview(
  engagementId: string,
  documentIds: readonly string[],
) {
  const engagement = await requireEngagement(engagementId);
  const { toSend, alreadySent } = earlyReviewSelection(engagement, documentIds);
  if (toSend.length === 0) {
    return {
      subject: "",
      attachmentCount: 0,
      sentCount: 0,
      alreadySentCount: alreadySent.length,
      alreadySent: true as const,
    };
  }

  const labels = toSend.map((document) =>
    escapeEmailHtml(
      complianceDocumentLabel(document.documentType, document.label),
    ),
  );
  const address = escapeEmailHtml(engagement.subjectAddress);
  const introduction =
    labels.length === 1
      ? `<p>The <strong>${labels[0]}</strong> for <strong>${address}</strong> is ready and attached.</p>`
      : [
          `<p>The following ${labels.length} checklist documents for <strong>${address}</strong> are ready and attached:</p>`,
          `<ul>${labels.map((label) => `<li>${label}</li>`).join("")}</ul>`,
        ].join("\n");

  const sent = await sendCertifierReply(engagementId, {
    body: [
      engagement.certifierName
        ? `<p>Hi ${escapeEmailHtml(engagement.certifierName)},</p>`
        : "<p>Hi,</p>",
      introduction,
      labels.length === 1
        ? "<p>Could you please verify this item while we continue collecting the rest of the checklist documents, and let us know if it needs revising?</p>"
        : "<p>Could you please verify these items while we continue collecting the rest of the checklist documents, and let us know if any of them need revising?</p>",
      "<p>Kind regards,<br/>Royal Constructions</p>",
    ].join("\n"),
    attachments: toSend.flatMap((document) =>
      document.files.map((file) => ({
        fileId: file.id,
        name: file.filename,
        url: file.url,
      })),
    ),
  });

  return {
    ...sent,
    alreadySent: false as const,
    sentCount: toSend.length,
    alreadySentCount: alreadySent.length,
  };
}

/**
 * Sends the completed checklist to the certifier for review.
 *
 * Moves the engagement to IN_REVIEW first, then sends. That order is
 * deliberate: the status is what swaps every upload control for an
 * approve/reject pair, and a send that succeeded while the status write failed
 * would leave the certifier looking at a file the admin can still change.
 */
export async function sendComplianceForReview(engagementId: string) {
  const engagement = await requireEngagement(engagementId);

  // The checklist evidence and the insurance certificate. Everything else the
  // builder supplied is already on this thread — the required pack came with
  // the outreach, the signed copies with their own send — so the review is the
  // one message that carries what the certifier has not seen.
  // Nothing to assess. A certifier who has said the job needs development
  // approval cannot start until the council has granted it, so the file must
  // not go over — the tab freezes the checklist for the same reason, and this
  // is the same sentence read from the other end so the two cannot disagree.
  const blocked = checklistBlockedReason(engagement);
  if (blocked) {
    throw new Error(blocked);
  }

  const evidence = engagement.documents.filter((doc) =>
    isReviewSubmissionType(doc.documentType),
  );
  // A line the admin marked as not applying to this job is not missing — it is
  // answered. Counting it here is what used to make an engagement unsendable
  // over a document nobody was ever going to supply.
  const outstanding = evidence.filter(isOutstandingEvidence);
  if (outstanding.length > 0) {
    throw new Error(
      `${outstanding.length} document${outstanding.length === 1 ? " is" : "s are"} still missing: ${outstanding
        .map((doc) => complianceDocumentLabel(doc.documentType, doc.label))
        .join(", ")}.`,
    );
  }

  const requiredEvidence = evidence.filter(
    (document) => !isNotRequired(document.status),
  );
  const unsentEvidence = requiredEvidence.filter(
    (document) => !hasSentCurrentDocument(engagement, document),
  );
  if (unsentEvidence.length === 0) {
    throw new Error(
      "The certifier already has the current copy of every checklist document.",
    );
  }

  const claimed = await advanceEngagementStatus(
    engagementId,
    [
      CertifierEngagementStatus.CHECKLIST_TRACKING,
      CertifierEngagementStatus.INSURANCE,
      // Re-sending after a round of rejections is the same act, so IN_REVIEW is
      // a legal starting point for it too.
      CertifierEngagementStatus.IN_REVIEW,
    ],
    CertifierEngagementStatus.IN_REVIEW,
  );

  // The transition is the only thing standing between this and a "the checklist
  // is complete" email sent in the middle of collection — the required pack
  // alone satisfies the missing-documents check above, because no checklist
  // items exist yet to be missing. Ignoring the claim sent that email anyway,
  // against an engagement whose status had not moved an inch.
  if (!claimed) {
    throw new Error(
      "The certifier's checklist has to be issued before the file can go for review.",
    );
  }

  // Every current file the certifier has not already received, in document
  // order. Early per-item review sends stay on the same thread and must not be
  // attached again when the rest of the checklist becomes complete.
  //
  // Rows marked not required are left out even where they still hold a file —
  // a line can be waved off after something was uploaded against it, and the
  // file stays so that putting the row back restores the evidence with it. It
  // is not part of this submission, and attaching it would send the certifier a
  // document for an item somebody has already decided they do not need.
  //
  // Size is not second-guessed here: `sendCertifierReply` hands these to Graph,
  // which asserts the total against the mailbox's MaxSendSize and switches to
  // an upload session past the inline ceiling on its own.
  const attachments = unsentEvidence.flatMap((doc) =>
    doc.files.map((file) => ({
      fileId: file.id,
      name: file.filename,
      url: file.url,
    })),
  );

  const isRemainingSend = unsentEvidence.length < requiredEvidence.length;
  let sent;
  try {
    sent = await sendCertifierReply(engagementId, {
      body: [
        "<p>Hi,</p>",
        isRemainingSend
          ? `<p>The remaining checklist documents for <strong>${escapeEmailHtml(engagement.subjectAddress)}</strong> are attached. Together with the items already sent on this thread, the checklist pack is now complete.</p>`
          : `<p>The checklist for <strong>${escapeEmailHtml(engagement.subjectAddress)}</strong> is complete. Everything you asked for is attached to this thread.</p>`,
        "<p>Could you review it and let us know if anything needs revising?</p>",
        "<p>Kind regards,<br/>Royal Constructions</p>",
      ].join("\n"),
      attachments,
    });
  } catch (error) {
    // Give the status back. IN_REVIEW is what the tab reads to decide the file
    // is with the certifier: it withdraws the send and freezes every row. The
    // send is offered once, so leaving the status claimed after a send that
    // never left the building strands the engagement — nothing left to press
    // here, and nothing on the certifier's end to answer. Back to whatever it
    // was a moment ago, which is the step the admin is actually still on.
    await advanceEngagementStatus(
      engagementId,
      [CertifierEngagementStatus.IN_REVIEW],
      engagement.status,
    );
    throw error;
  }

  after(async () => {
    await notifyCompliance("complianceReviewSent", engagement.projectId, {
      documentCount: unsentEvidence.length,
    });
  });

  return sent;
}

/**
 * "A", "A and B", "A, B and C" — a list a sentence can hold.
 */
function listSentence(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What the certifier still owes when the signatures go back, and the words for
 * asking, in the order they are asked for.
 *
 * Only these two. The fee proposal and the CDC form are not chased here
 * whatever our own vault says — we are attaching them back signed, so they
 * plainly arrived, and a filing gap on our side is not something to ask the
 * certifier to fix.
 */
const SIGNED_COPIES_FOLLOW_UPS: readonly {
  type: ComplianceDocumentType;
  phrase: string;
}[] = [
  { type: ComplianceDocumentType.CHECKLIST, phrase: "document checklist" },
  { type: ComplianceDocumentType.INVOICE, phrase: "invoice" },
];

/**
 * What to say when the signed copies go back.
 *
 * Written from what the certifier has actually sent rather than fixed, because
 * the fixed version asked every certifier for their document checklist —
 * including the ones who had attached it to the same email as the fee proposal
 * and the CDC form, which is common. Asking someone to send a document that is
 * already in our vault, in a reply to the mail they sent it on, is how a thread
 * stops being read.
 *
 * So the ask covers only what is genuinely outstanding, and when the checklist
 * is already in hand the mail says what happens next instead of asking for
 * anything.
 */
function signedCopiesBody(engagement: CertifierEngagementDetail): string {
  const received = new Set(
    engagement.documents
      .filter((doc) => doc.files.length > 0)
      .map((doc) => doc.documentType),
  );

  const outstanding = SIGNED_COPIES_FOLLOW_UPS.filter(
    (item) => !received.has(item.type),
  ).map((item) => item.phrase);

  const greeting = engagement.certifierName
    ? `Hi ${escapeEmailHtml(engagement.certifierName)},`
    : "Hi,";
  const address = escapeEmailHtml(engagement.subjectAddress);

  return [
    `<p>${greeting}</p>`,
    `<p>Please find the signed fee proposal and CDC application form for <strong>${address}</strong> attached.</p>`,
    outstanding.length > 0
      ? `<p>Could you send through your ${listSentence(outstanding)} when you are ready?</p>`
      : null,
    received.has(ComplianceDocumentType.CHECKLIST)
      ? "<p>Your document checklist has already come through — we are working through it now and will send the evidence across as soon as it is together.</p>"
      : null,
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ]
    .filter((paragraph): paragraph is string => paragraph !== null)
    .join("\n");
}

/**
 * Sends the countersigned fee proposal and CDC form back to the certifier.
 *
 * This is what the certifier is waiting on before they will issue a checklist,
 * and it is the one step in the flow with no natural prompt — the admin has
 * just uploaded two files and would otherwise have to know that a separate
 * send has to happen. The UI fires it as soon as the second copy lands.
 *
 * Guarded on the status transition rather than on a flag: `SIGNING` is reached
 * exactly once, so a double click, or two tabs both watching the same upload
 * complete, produce one email rather than two.
 *
 * What it says is `signedCopiesBody`'s job, and that depends on what the
 * certifier has sent so far.
 */
export async function sendSignedCopies(engagementId: string) {
  const engagement = await requireEngagement(engagementId);

  const signed = SIGNED_COPY_DOCUMENTS.map((copy) => ({
    ...copy,
    document: engagement.documents.find(
      (doc) => doc.documentType === copy.type,
    ),
  }));

  const missing = signed.filter(
    (copy) => (copy.document?.files.length ?? 0) === 0,
  );
  if (missing.length > 0) {
    throw new Error(
      `Still waiting on the ${missing.map((copy) => copy.label).join(" and ")}.`,
    );
  }

  const claimed = await advanceEngagementStatus(
    engagementId,
    [
      CertifierEngagementStatus.RESPONSE_RECEIVED,
      CertifierEngagementStatus.OUTREACH_SENT,
      CertifierEngagementStatus.AWAITING_RESPONSE,
    ],
    CertifierEngagementStatus.SIGNING,
  );

  if (!claimed) {
    // Someone else already sent them. Not an error — the caller's intent has
    // been satisfied, just not by this call.
    return { alreadySent: true as const };
  }

  const attachments = signed.flatMap((copy) =>
    (copy.document?.files ?? []).map((file) => ({
      fileId: file.id,
      name: file.filename,
      url: file.url,
    })),
  );

  try {
    await sendCertifierReply(engagementId, {
      body: signedCopiesBody(engagement),
      attachments,
    });
  } catch (error) {
    // The status move is what gates "Get Checklist", so a failed send has to
    // give it back — otherwise the admin is let through to ask for a checklist
    // the certifier was never sent the signatures for.
    await advanceEngagementStatus(
      engagementId,
      [CertifierEngagementStatus.SIGNING],
      CertifierEngagementStatus.RESPONSE_RECEIVED,
    );
    throw error;
  }

  return { alreadySent: false as const, attachmentCount: attachments.length };
}

/**
 * Relabels a received document the classifier could not place.
 *
 * Inbound attachments land as UNKNOWN when the model is not confident, which is
 * the right default — a mislabelled document routes itself into the wrong slot
 * silently. But without this there is no way back: the response blocks key on
 * document type, so an unclassified checklist left the whole engagement
 * stranded with the file stored and unreachable.
 *
 * Only an UNKNOWN document can be relabelled, so this cannot be used to turn a
 * rejected checklist item into an approved required document. It used to be
 * narrowed to the four types a certifier sends as well, which left anything a
 * surveyor, a consultant or a council sent that the classifier could not name
 * with nowhere to go. The person choosing is the check now; the list is
 * `IDENTIFIABLE_DOCUMENT_TYPES`, which the picker reads too.
 *
 * Two routes, because the two kinds of document mean different things:
 *
 *   - A certifier's own response (invoice, fee proposal, CDC form, checklist)
 *     is placed the way the inbound workflow places it, keeping RECEIVED.
 *   - Anything else is evidence for the file, and placing it by hand is the
 *     same event as dragging it onto that row — so it goes through the upload
 *     path and gets every follow-up an upload gets: the checklist lines it
 *     answers, the HBCF number off an insurance certificate, the title-search
 *     check, the certificate closing the file. Placed without those, a survey
 *     identified here would sit on the file with its alerts still open.
 *
 * Either way placing is a replacement, not a rename: the category may already
 * hold the copy this one supersedes.
 */
export async function classifyReceivedDocument(params: {
  projectId: string;
  documentId: string;
  documentType: ComplianceDocumentType;
}) {
  if (!isIdentifiableDocumentType(params.documentType)) {
    throw new Error("That is not a type a received file can be placed as.");
  }

  const arrival = await prisma.complianceDocument.findFirst({
    where: {
      id: params.documentId,
      documentType: ComplianceDocumentType.UNKNOWN,
      engagement: { projectId: params.projectId },
    },
    select: {
      id: true,
      engagementId: true,
      files: { select: { id: true }, orderBy: { createdAt: "asc" } },
    },
  });

  // Gone, or emptied by a second click that got here first.
  if (!arrival || arrival.files.length === 0) {
    throw new Error("That document has already been identified.");
  }

  if (!isCertifierResponseType(params.documentType)) {
    const document = await attachComplianceDocumentFile({
      engagementId: arrival.engagementId,
      projectId: params.projectId,
      documentType: params.documentType,
      fileId: arrival.files[0].id,
    });
    // The arrival's row is empty now, and nothing else points at it.
    await prisma.complianceDocument.deleteMany({
      where: { id: arrival.id, files: { none: {} } },
    });
    return { documentId: document.id, documentType: params.documentType };
  }

  const placed = await placeInboundDocument({
    engagementId: arrival.engagementId,
    documentId: arrival.id,
    documentType: params.documentType,
  });

  // Two admins on the same unplaced attachment: the transaction let one
  // through and found nothing left for the other.
  if (!placed.documentId) {
    throw new Error("That document has already been identified.");
  }

  after(async () => {
    revalidateEngagement(params.projectId);
    await discardSupersededFiles(arrival.engagementId, placed.superseded);
  });

  return { documentId: placed.documentId, documentType: params.documentType };
}

/**
 * Throws away an unidentified attachment that is not part of the job. The rule
 * is `dismissUnidentifiedComplianceDocument`; this adds the cache, the log
 * line and the activity entry.
 */
export async function dismissReceivedDocument(params: {
  principal: DomainPrincipal;
  projectId: string;
  documentId: string;
  dismissedBy: string;
}) {
  const outcome = await dismissUnidentifiedComplianceDocument(
    params.principal,
    params,
    prisma,
    { deleteBlob: vercelBlobDelete },
  );

  after(() => revalidateEngagement(params.projectId));

  if (outcome.reclaimError) {
    console.error(
      `Dismissed compliance document ${outcome.documentId}, but its storage could not be reclaimed`,
      outcome.reclaimError,
    );
  }

  await logAction(
    createActivityLogEntry("complianceDocumentDismissed", {
      projectId: params.projectId,
      engagementId: outcome.engagementId,
      documentId: outcome.documentId,
      fileNames: [...outcome.fileNames],
      dismissedBy: params.dismissedBy,
    }),
  );

  return outcome;
}
