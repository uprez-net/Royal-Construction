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
  CERTIFIER_RESPONSE_DOCUMENTS,
  complianceDocumentLabel,
  isApprovableDocumentType,
  isReviewSubmissionType,
  REQUIRED_COMPLIANCE_DOCUMENTS,
  SIGNED_COPY_DOCUMENTS,
} from "@/constants/complianceDocuments";
import {
  buildCertifierReplySubject,
  buildCertifierSubject,
  generateCertifierRefToken,
} from "@/lib/graph/certifier-subject";
import { createGraphContext, type EmailAttachment } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import {
  discardSupersededFiles,
  placeInboundDocument,
} from "@/lib/compliance/document-replacement";
import {
  canSendRequiredPack,
  hasSentRequiredPack,
  sentToCertifierUrls,
  unsentRequiredDocuments,
} from "@/lib/compliance/required-pack";
import { recordHomeInsuranceOnProject } from "@/lib/compliance/home-insurance";
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

  const labels = updated
    .map((doc) => escapeEmailHtml(doc.label))
    .join(", ");

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

  if (engagement.lastInboundMessageId) {
    // A real reply: Graph builds it from the certifier's own message, so it
    // carries In-Reply-To, References and the conversation id, and lands in
    // their existing thread rather than beside it.
    await client.replyToMessage({
      messageId: engagement.lastInboundMessageId,
      body: input.body,
      to: certifierEmail,
      cc: config.cc,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  } else {
    // Nothing to reply to yet — the certifier has not answered the outreach.
    // Subject threading is all that is available, and it is what opens the
    // thread the replies above will later join.
    await client.sendMail({
      to: certifierEmail,
      subject,
      body: input.body,
      cc: config.cc,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }

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
    // `url` is read for the re-supply email below, which attaches the
    // replacement rather than telling the certifier one exists somewhere.
    select: { id: true, filename: true, url: true },
  });
  if (!file) {
    throw new Error(`File ${params.fileId} not found.`);
  }

  const {
    document,
    sentBackFor,
    superseded,
  } = await prisma.$transaction(async (tx) => {
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
  });

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
    revalidateEngagement(params.projectId);
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

  // The certifier reviews the evidence they asked for, and nothing else. The
  // required pack and the signed copies are already theirs; approving or
  // rejecting one of those is not a decision anybody is entitled to make, and
  // the UI no longer offers it — this is what stops a stale tab, or a direct
  // call, from making it anyway and freezing a row nobody can then re-upload.
  if (!isApprovableDocumentType(document.documentType)) {
    throw new Error(
      `${complianceDocumentLabel(document.documentType, document.label)} is not reviewed by the certifier.`,
    );
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
        // Checklist evidence is the whole of the review loop, so it is the
        // whole of what can hold the engagement open. Counting anything else
        // left it permanently one approval short of closing, against rows the
        // UI gives nobody a way to approve.
        documentType: ComplianceDocumentType.CHECKLIST_ITEM,
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

  // The checklist evidence and the insurance certificate. Everything else the
  // builder supplied is already on this thread — the required pack came with
  // the outreach, the signed copies with their own send — so the review is the
  // one message that carries what the certifier has not seen.
  const evidence = engagement.documents.filter((doc) =>
    isReviewSubmissionType(doc.documentType),
  );
  const outstanding = evidence.filter((doc) => doc.files.length === 0);
  if (outstanding.length > 0) {
    throw new Error(
      `${outstanding.length} document${outstanding.length === 1 ? " is" : "s are"} still missing: ${outstanding
        .map((doc) => complianceDocumentLabel(doc.documentType, doc.label))
        .join(", ")}.`,
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

  // Every file behind that set, in document order. The message says everything
  // is attached, and before this nothing was.
  //
  // Size is not second-guessed here: `sendCertifierReply` hands these to Graph,
  // which asserts the total against the mailbox's MaxSendSize and switches to
  // an upload session past the inline ceiling on its own.
  const attachments = evidence.flatMap((doc) =>
    doc.files.map((file) => ({
      fileId: file.id,
      name: file.filename,
      url: file.url,
    })),
  );

  const sent = await sendCertifierReply(engagementId, {
    body: [
      "<p>Hi,</p>",
      `<p>The checklist for <strong>${engagement.subjectAddress}</strong> is complete. Everything you asked for is attached to this thread.</p>`,
      "<p>Could you review it and let us know if anything needs revising?</p>",
      "<p>Kind regards,<br/>Royal Constructions</p>",
    ].join("\n"),
    attachments,
  });

  after(async () => {
    await notifyCompliance("complianceReviewSent", engagement.projectId, {
      documentCount: evidence.length,
    });
  });

  return sent;
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
      body: [
        "<p>Hi,</p>",
        `<p>Please find the signed fee proposal and CDC application form for <strong>${engagement.subjectAddress}</strong> attached.</p>`,
        "<p>Could you send through your document checklist when you are ready?</p>",
        "<p>Kind regards,<br/>Royal Constructions</p>",
      ].join("\n"),
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
 * silently. But without this there is no way back: the four response blocks key
 * on document type, so an unclassified checklist left the whole engagement
 * stranded with the file stored and unreachable.
 *
 * Deliberately narrow. Only an UNKNOWN document can be relabelled, and only to
 * something a certifier actually sends, so this cannot be used to turn a
 * rejected checklist item into an approved required document.
 *
 * Placing it is a replacement, not a rename: the same category may already hold
 * the copy this one supersedes — the classifier is least sure precisely when a
 * certifier re-sends a revised form — so it goes through the same path the
 * workflow's own classification does.
 */
export async function classifyReceivedDocument(params: {
  projectId: string;
  documentId: string;
  documentType: ComplianceDocumentType;
}) {
  if (!CERTIFIER_RESPONSE_DOCUMENTS.some((doc) => doc.type === params.documentType)) {
    throw new Error("That is not a document type the certifier sends.");
  }

  const arrival = await prisma.complianceDocument.findFirst({
    where: {
      id: params.documentId,
      documentType: ComplianceDocumentType.UNKNOWN,
      engagement: { projectId: params.projectId },
    },
    select: { id: true, engagementId: true },
  });

  if (!arrival) {
    throw new Error("That document has already been identified.");
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
