"use server";

import {
  CertifierEmailDirection,
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  Prisma,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  complianceDocumentLabel,
  REQUIRED_COMPLIANCE_DOCUMENTS,
} from "@/constants/complianceDocuments";
import {
  buildCertifierReplySubject,
  buildCertifierSubject,
  generateCertifierRefToken,
} from "@/lib/graph/certifier-subject";
import { createGraphContext, type EmailAttachment } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { notifyCompliance } from "@/lib/compliance/notify";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
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

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getCertifierEngagement(
  projectId: string,
): Promise<CertifierEngagementDetail | null> {
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
  projectId: string,
  input: StartEngagementInput,
): Promise<CertifierEngagementDetail> {
  const existing = await prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: engagementInclude,
  });
  if (existing) {
    return existing;
  }

  const engagement = await prisma.certifierEngagement.create({
    data: {
      projectId,
      refToken: generateCertifierRefToken(),
      subjectAddress: input.subjectAddress,
      certifierName: input.certifierName ?? null,
      certifierEmail: input.certifierEmail,
      certifierPhone: input.certifierPhone ?? null,
      status: CertifierEngagementStatus.COLLECTING_DOCS,
      documents: {
        create: REQUIRED_COMPLIANCE_DOCUMENTS.map((doc, index) => ({
          documentType: doc.type,
          status: ComplianceDocumentStatus.PENDING,
          order: index,
        })),
      },
    },
    include: engagementInclude,
  });

  after(() => revalidateEngagement(projectId));

  return engagement;
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
): string {
  const greeting = certifierName ? `Hi ${certifierName},` : "Hi,";
  return [
    `<p>${greeting}</p>`,
    `<p>Please find attached the documentation for <strong>${subjectAddress}</strong>.</p>`,
    "<p>Could you send through your fee proposal, the CDC application form and your document checklist when you have a moment?</p>",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ].join("\n");
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

  const missing = REQUIRED_COMPLIANCE_DOCUMENTS.filter((required) => {
    const doc = engagement.documents.find(
      (candidate) => candidate.documentType === required.type,
    );
    return !doc || doc.files.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `Still missing ${missing.map((doc) => doc.label).join(", ")}.`,
    );
  }

  const requiredTypes = new Set<ComplianceDocumentType>(
    REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => doc.type),
  );
  const files = engagement.documents
    .filter((doc) => requiredTypes.has(doc.documentType))
    .flatMap((doc) => doc.files);

  const config = getGraphConfig();
  const client = await createGraphContext(config);
  const subject = buildCertifierSubject(
    engagement.refToken,
    engagement.subjectAddress,
  );
  const body = outreachBody(engagement.certifierName, engagement.subjectAddress);
  const attachments = await Promise.all(files.map(toEmailAttachment));

  await client.sendMail({
    to: certifierEmail,
    subject,
    body,
    cc: config.cc,
    attachments,
  });

  await recordOutboundEmail({
    engagementId,
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

  const config = getGraphConfig();
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

  await client.sendMail({
    to: certifierEmail,
    subject,
    body: input.body,
    cc: config.cc,
    ...(attachments.length > 0 ? { attachments } : {}),
  });

  await recordOutboundEmail({
    engagementId,
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
    select: { id: true, filename: true },
  });
  if (!file) {
    throw new Error(`File ${params.fileId} not found.`);
  }

  const document = await prisma.$transaction(async (tx) => {
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

    await tx.file.update({
      where: { id: file.id },
      data: { complianceDocumentId: target.id },
    });

    // Clearing rejectionReason is half the point of a re-upload: the document
    // is back in play, and leaving the old reason on it would keep showing why
    // the previous attempt failed as though it were still current.
    return tx.complianceDocument.update({
      where: { id: target.id },
      data: {
        status: ComplianceDocumentStatus.UPLOADED,
        rejectionReason: null,
      },
    });
  });

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceDocumentUploaded", {
        projectId: params.projectId,
        engagementId: params.engagementId,
        documentId: document.id,
        documentLabel: complianceDocumentLabel(
          document.documentType,
          document.label,
        ),
        fileName: file.filename,
      }),
    );
  });

  return document;
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
}) {
  const document = await prisma.complianceDocument.findFirst({
    where: {
      id: params.documentId,
      engagement: { projectId: params.projectId },
    },
    select: {
      id: true,
      engagementId: true,
      documentType: true,
      label: true,
      status: true,
    },
  });

  if (!document) {
    throw new Error("Compliance document not found on this project.");
  }

  after(() => revalidateEngagement(params.projectId));

  const approving = params.decision === "approved";

  const claim = await prisma.complianceDocument.updateMany({
    where: {
      id: document.id,
      // Only a document with evidence on it can be decided. An APPROVED row is
      // frozen, and a PENDING one has nothing to judge.
      status: {
        in: [
          ComplianceDocumentStatus.UPLOADED,
          ComplianceDocumentStatus.RECEIVED,
        ],
      },
    },
    data: approving
      ? {
          status: ComplianceDocumentStatus.APPROVED,
          rejectionReason: null,
        }
      : {
          status: ComplianceDocumentStatus.PENDING,
          rejectionReason: params.rejectionReason ?? null,
        },
  });

  if (claim.count === 0) {
    // Someone else got there first, or this tab is stale. Re-read rather than
    // assume which, so the caller can say what actually happened.
    const current = await prisma.complianceDocument.findUnique({
      where: { id: document.id },
      select: { status: true },
    });
    return {
      resolved: false as const,
      status: current?.status ?? document.status,
    };
  }

  const documentLabel = complianceDocumentLabel(
    document.documentType,
    document.label,
  );

  if (!approving) {
    // Only the rejection is announced. Approving one of twenty checklist items
    // is not news; being told to redo one is.
    after(async () => {
      await notifyCompliance("complianceDocumentRejected", params.projectId, {
        documentLabel,
        rejectionReason: params.rejectionReason ?? "",
        resolvedBy: params.resolvedBy,
      });
    });
  }

  after(async () => {
    await logAction(
      approving
        ? createActivityLogEntry("complianceDocumentApproved", {
            projectId: params.projectId,
            engagementId: document.engagementId,
            documentId: document.id,
            documentLabel,
            resolvedBy: params.resolvedBy,
          })
        : createActivityLogEntry("complianceDocumentRejected", {
            projectId: params.projectId,
            engagementId: document.engagementId,
            documentId: document.id,
            documentLabel,
            resolvedBy: params.resolvedBy,
            rejectionReason: params.rejectionReason ?? "",
          }),
    );
  });

  // Every document being approved is what freezes the section, so the
  // engagement's own status follows the last decision rather than needing a
  // separate button nobody would remember to press.
  if (approving) {
    const outstanding = await prisma.complianceDocument.count({
      where: {
        engagementId: document.engagementId,
        status: { not: ComplianceDocumentStatus.APPROVED },
      },
    });
    if (outstanding === 0) {
      const closed = await advanceEngagementStatus(
        document.engagementId,
        [
          CertifierEngagementStatus.IN_REVIEW,
          CertifierEngagementStatus.CHECKLIST_TRACKING,
          CertifierEngagementStatus.INSURANCE,
        ],
        CertifierEngagementStatus.APPROVED,
      );
      // Sent only by the call that actually closed the engagement. Two admins
      // approving the last two documents at once would otherwise both see zero
      // outstanding and both announce it.
      if (closed) {
        after(async () => {
          await notifyCompliance("complianceApproved", params.projectId, {});
        });
      }
    }
  }

  return {
    resolved: true as const,
    status: approving
      ? ComplianceDocumentStatus.APPROVED
      : ComplianceDocumentStatus.PENDING,
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

  const evidence = engagement.documents.filter(
    (doc) => doc.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
  );
  const outstanding = evidence.filter((doc) => doc.files.length === 0);
  if (evidence.length > 0 && outstanding.length > 0) {
    throw new Error(
      `${outstanding.length} checklist item${outstanding.length === 1 ? " is" : "s are"} still missing a document.`,
    );
  }

  await advanceEngagementStatus(
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

  const sent = await sendCertifierReply(engagementId, {
    body: [
      "<p>Hi,</p>",
      `<p>The checklist for <strong>${engagement.subjectAddress}</strong> is complete. Everything you asked for is attached to this thread.</p>`,
      "<p>Could you review it and let us know if anything needs revising?</p>",
      "<p>Kind regards,<br/>Royal Constructions</p>",
    ].join("\n"),
  });

  after(async () => {
    await notifyCompliance("complianceReviewSent", engagement.projectId, {
      documentCount: engagement.documents.filter(
        (doc) => doc.files.length > 0,
      ).length,
    });
  });

  return sent;
}
