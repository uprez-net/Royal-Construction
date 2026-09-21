import "server-only";

import {
  CertifierEmailDirection,
  ComplianceDocumentType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
  GraphMailbox,
  Prisma,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  isApprovalParty,
  isConsultantParty,
  PARTY_LABEL,
  PARTY_OUTREACH_ATTACHMENTS,
} from "@/constants/complianceDocuments";
import { resolveExtraAttachments } from "@/lib/compliance/party-mail";
import { partyBlockedReason } from "@/lib/compliance/prerequisites";
import {
  buildPartySubject,
  generatePartyRefToken,
} from "@/lib/graph/party-subject";
import { createGraphContext, type EmailAttachment } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { notifyCompliance } from "@/lib/compliance/notify";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  outreachForParty,
  type CertifierEmailAttachment,
  type CertifierEngagementDetail,
} from "@/types/compliance";
import { normalizeEmailAddress } from "@/utils/formatters";
import { generateEmailChecksum } from "@/utils/generator";
import type {
  PartyReplyInput,
  StartPartyOutreachInput,
} from "@/utils/validators/compliance";
import { sanitizeLeadNotesHtml } from "@/lib/rich-text/lead-notes";
import { logAction } from "./actionLog";

// ---------------------------------------------------------------------------
// Shared plumbing
//
// Deliberately a sibling of lib/data/compliance.ts rather than an addition to
// it. That module is the certifier's flow -- outreach, signed copies, checklist,
// review -- and is long enough already; this one is the same three verbs
// (engage, send, record) applied to whichever party is being dealt with. What
// the two genuinely share is the mail table and the revalidation tags, and
// those are small enough to restate rather than couple over.
// ---------------------------------------------------------------------------

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`certifier-engagement-${projectId}`, CACHE_PROFILES.SHORT);
}

async function requireEngagement(
  projectId: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: certifierEngagementInclude,
  });
  if (!engagement) {
    throw new Error(
      "This project has no compliance file yet. Connect with a certifier first.",
    );
  }
  return engagement;
}

/**
 * Reads a blob back into the base64 Graph wants.
 *
 * Fetched at send time rather than carried around, for the same reason the
 * certifier send does it: blob storage is already durable, and a survey set
 * runs to tens of megabytes that have no business sitting in memory any longer
 * than the one request that sends them.
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
 * Records a message this system sent on a party thread.
 *
 * Same checksum key as every other path into this table, so an outbound copy
 * that comes back around through the mailbox subscription lands on the row
 * already here instead of duplicating the bubble. `outreachId` is what files it
 * under the party rather than the certifier.
 */
async function recordOutboundEmail(params: {
  engagementId: string;
  outreachId: string;
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
        outreachId: params.outreachId,
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

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

/**
 * Whether a party can be engaged yet.
 *
 * A thin wrapper over `partyBlockedReason`, which is the same reading the tab
 * takes. This used to be its own implementation, with a near-copy on the tab,
 * and near-identical is exactly the problem: the two drifted the moment the
 * architect grew a second prerequisite, and the result was a section the tab
 * unlocked and the server then refused, with two different sentences saying so.
 *
 * Kept as a function of its own rather than inlined at the call sites, because
 * it is the refusal boundary — everything below treats a non-null return as
 * "throw this at the user".
 */
export async function partyPrerequisiteFailure(
  engagement: CertifierEngagementDetail,
  party: CompliancePartyType,
): Promise<string | null> {
  return partyBlockedReason(engagement, party);
}

// ---------------------------------------------------------------------------
// Opening an outreach
// ---------------------------------------------------------------------------

/** Escapes a value for the plain HTML bodies above. */
function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Engages a party and sends them their opening email.
 *
 * The row is written before the mail goes out, which is the same order the
 * certifier outreach uses and for the same reason: a send that succeeds while
 * the row that records it does not is a thread nobody can find, while a row
 * with no mail behind it is visible, obviously incomplete, and retryable.
 *
 * Idempotent through the `[engagementId, party]` unique index -- a second
 * submission finds the outreach that already exists and does not send again.
 */
export async function startPartyOutreach(
  projectId: string,
  input: StartPartyOutreachInput,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);
  const { party } = input;

  const existing = outreachForParty(engagement, party);

  // Already engaged, and the mail has gone. A second submission is the same act
  // repeated, not a new thread.
  if (existing && existing.status !== ComplianceOutreachStatus.NOT_SENT) {
    return engagement;
  }

  // A row with no mail behind it. That is what a send that threw after the row
  // was written leaves, and returning early on it -- as this used to -- left
  // the section unlocked, the party never actually written to, and no way to
  // try again: the unique index refused a second row and the early return
  // refused a second send. So the retry rides the row that is already there,
  // re-pointing it at whoever was picked this time.
  if (existing && existing.mode === ComplianceOutreachMode.SELF_SUPPLIED) {
    return engagement;
  }

  const blocked = await partyPrerequisiteFailure(engagement, party);
  if (blocked) {
    throw new Error(blocked);
  }

  /**
   * Which of the supplied checklist ids are actually rows on this file.
   *
   * The route validates them as ids and authorises the project; the foreign key
   * checks only that a `ComplianceDocument` with that id exists. Neither asks
   * whether it belongs to *this* engagement, so an id lifted from another job
   * was accepted and stored on the deliverable.
   *
   * Nothing then fails loudly. The inbound workflow refuses a target whose
   * `engagementId` does not match and files the reply by type instead, so the
   * line that asked for the report stays outstanding for good while a
   * deliverable row on this job points at somebody else's checklist.
   *
   * Unknown ids are dropped rather than refused, which is also what a checklist
   * re-extracted between opening the modal and pressing send leaves behind. The
   * engagement is still the right one to open; it simply answers no line.
   */
  const ownDocumentIds = new Set(
    engagement.documents.map((document) => document.id),
  );
  const ownChecklistId = (id: string | null | undefined) =>
    id && ownDocumentIds.has(id) ? id : null;

  const contactEmail = normalizeEmailAddress(input.contactEmail);
  const contact = {
    tradieId: input.tradieId ?? null,
    contactName: input.contactName ?? null,
    contactEmail,
    contactPhone: input.contactPhone ?? null,
    // The checklist line this was raised off, for a consultant. Recorded when
    // the outreach opens rather than matched when the reply lands: what a BASIX
    // consultant sends back satisfies the item that asked for it, and by then
    // there may be three items mentioning BASIX.
    //
    // Superseded by the deliverables written below and kept for the consultants
    // that produce exactly one thing, which is every row this system wrote
    // before the deliverables table existed. A structural engineer answers
    // three lines and this column can only name one, so it is left null for
    // them rather than made to pick a favourite.
    checklistDocumentId:
      isConsultantParty(party) && input.deliverables.length <= 1
        ? ownChecklistId(input.checklistDocumentId)
        : null,
    // Which estate was picked, for a developer. Not the contact -- the address
    // is `contactEmail` above like everybody else's, because the list holds an
    // address for some estates and not others and the picker lets it be typed.
    developerKey: isApprovalParty(party) ? (input.developerKey ?? null) : null,
  };

  const outreach = existing
    ? await prisma.complianceOutreach.update({
        where: { id: existing.id },
        // The token is deliberately not reminted. Nothing was sent under it, so
        // it carries no history -- but keeping it means a row can only ever
        // have had one token, which is what makes the reverse lookup safe.
        data: contact,
      })
    : await prisma.complianceOutreach.create({
        data: {
          engagementId: engagement.id,
          party,
          refToken: generatePartyRefToken(party),
          mode: ComplianceOutreachMode.OUTREACH,
          status: ComplianceOutreachStatus.NOT_SENT,
          graphMailbox: GraphMailbox.ADMIN,
          ...contact,
        },
      });

  // Which checklist lines this engagement answers.
  //
  // Written before the mail rather than after it, for the same reason the row
  // itself is: a send that succeeds against a row with no deliverables on it is
  // a reply nobody can file, while deliverables with no mail behind them are
  // visible, obviously incomplete, and retryable.
  //
  // Replaced rather than merged, because the request carries the whole set. A
  // retry of a send that failed halfway is the same engagement described again,
  // not a second set of things to ask for.
  if (input.deliverables.length > 0) {
    await prisma.$transaction([
      prisma.complianceOutreachDeliverable.deleteMany({
        where: { outreachId: outreach.id },
      }),
      prisma.complianceOutreachDeliverable.createMany({
        data: input.deliverables.map((deliverable) => ({
          outreachId: outreach.id,
          documentType: deliverable.documentType,
          checklistDocumentId: ownChecklistId(deliverable.checklistDocumentId),
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  // What this party is given to work from. The surveyor's deed was uploaded in
  // the modal moments ago and the architect's set is whatever the surveyor
  // produced -- both resolved off the document rows rather than passed in, so
  // the mail carries the current copy of each rather than whatever the client
  // happened to be looking at.
  const attachmentTypes = new Set<ComplianceDocumentType>(
    PARTY_OUTREACH_ATTACHMENTS[party],
  );
  const packFiles = engagement.documents
    .filter((document) => attachmentTypes.has(document.documentType))
    .flatMap((document) => document.files);

  // What the sender added on top, resolved from ids against this project. The
  // table above is what a party always needs; this is the covenant schedule,
  // the neighbour's consent, the photograph of the pegs -- the things nobody
  // could have listed in advance, which turn out to come up on most of these.
  const extraFiles = await resolveExtraAttachments(
    projectId,
    input.extraAttachmentIds,
  );

  // De-duplicated against the table's own, because the picker offers everything
  // on the file and the obvious thing to reach for is the document the party
  // was going to be sent anyway. Sending it twice is not fatal and does look
  // like we do not know what we already sent.
  const packIds = new Set(packFiles.map((file) => file.id));
  const files = [
    ...packFiles,
    ...extraFiles.filter((file) => !packIds.has(file.id)),
  ];

  const config = getGraphConfig(
    outreach.graphMailbox === GraphMailbox.ADMIN ? "admin" : "business",
  );
  const client = await createGraphContext(config);
  const subject = buildPartySubject(
    outreach.refToken,
    engagement.subjectAddress,
  );
  const body = sanitizeLeadNotesHtml(input.body);
  if (!body.replace(/<[^>]*>/g, "").trim()) {
    throw new Error("The email body cannot be empty.");
  }

  const attachments = await Promise.all(files.map(toEmailAttachment));

  await client.sendMail({
    to: contactEmail,
    subject,
    body,
    cc: config.cc,
    attachments,
  });

  await recordOutboundEmail({
    engagementId: engagement.id,
    outreachId: outreach.id,
    graphMailbox: outreach.graphMailbox,
    emailFrom: config.senderUpn ?? "",
    emailTo: contactEmail,
    subject,
    body,
    attachments: files.map((file) => ({
      name: file.filename,
      url: file.url,
    })),
  });

  await prisma.complianceOutreach.update({
    where: { id: outreach.id },
    // sentAt is the clock every overdue alert on this party is measured from,
    // and it is stamped here rather than taken from updatedAt for the reason
    // the column exists: updatedAt moves on a follow-up, on a reply landing and
    // on a meeting being booked, so an SLA read off it would reset itself every
    // time anybody touched the row.
    data: { status: ComplianceOutreachStatus.SENT, sentAt: new Date() },
  });

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("complianceOutreachSent", {
        projectId,
        engagementId: engagement.id,
        outreachId: outreach.id,
        party,
        contactEmail,
        refToken: outreach.refToken,
        attachmentCount: files.length,
      }),
    );
    await notifyCompliance("complianceOutreachSent", projectId, {
      party: PARTY_LABEL[party],
      contactEmail,
      attachmentCount: files.length,
    });
  });

  return requireEngagement(projectId);
}

/**
 * Records that the client turned up with this party's documents already.
 *
 * No mail, no contact, no token: there is nobody to correlate a reply to. It is
 * still a row, because everything downstream asks "has this party been dealt
 * with" rather than "did we email anybody", and a file where the client brought
 * their own survey is finished with the surveyor in every sense that matters to
 * the architect waiting behind them.
 *
 * The refToken is minted anyway. It costs nothing, it keeps the column
 * non-null for every row, and it means an outreach that later has to become a
 * real thread already has the one thing it cannot be given retroactively.
 */
export async function recordPartySelfSupplied(
  projectId: string,
  party: CompliancePartyType,
  recordedBy: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);

  if (outreachForParty(engagement, party)) {
    return engagement;
  }

  const blocked = await partyPrerequisiteFailure(engagement, party);
  if (blocked) {
    throw new Error(blocked);
  }

  const outreach = await prisma.complianceOutreach.create({
    data: {
      engagementId: engagement.id,
      party,
      refToken: generatePartyRefToken(party),
      mode: ComplianceOutreachMode.SELF_SUPPLIED,
      // NOT_SENT and staying there. There is no mail to send and none coming
      // back; the documents arrive by upload like any other.
      status: ComplianceOutreachStatus.NOT_SENT,
      graphMailbox: GraphMailbox.ADMIN,
    },
  });

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("complianceOutreachSelfSupplied", {
        projectId,
        engagementId: engagement.id,
        outreachId: outreach.id,
        party,
        recordedBy,
      }),
    );
  });

  return requireEngagement(projectId);
}

/**
 * Sends a message on an existing party thread.
 *
 * Replies against `lastInboundMessageId` where there is one, so the message
 * carries real In-Reply-To and References headers and lands in the thread the
 * party is already reading. Falls back to a subject-threaded send before they
 * have answered once, which is the same trade `sendCertifierReply` makes.
 */
export async function sendPartyReply(
  projectId: string,
  outreachId: string,
  input: Omit<PartyReplyInput, "outreachId">,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);
  const outreach = engagement.outreaches.find(
    (candidate) => candidate.id === outreachId,
  );
  if (!outreach) {
    throw new Error("No such outreach on this compliance file.");
  }
  if (!outreach.contactEmail) {
    throw new Error(
      `The ${PARTY_LABEL[outreach.party].toLowerCase()} documents were supplied by the client — there is no thread to reply on.`,
    );
  }

  const config = getGraphConfig(
    outreach.graphMailbox === GraphMailbox.ADMIN ? "admin" : "business",
  );
  const client = await createGraphContext(config);
  const subject = buildPartySubject(
    outreach.refToken,
    engagement.subjectAddress,
  );

  const extraFiles = await resolveExtraAttachments(
    projectId,
    input.extraAttachmentIds ?? [],
  );
  const requestedAttachments = [
    ...input.attachments,
    ...extraFiles.map((file) => ({
      fileId: file.id,
      name: file.filename,
      url: file.url,
    })),
  ].filter(
    (attachment, index, all) =>
      all.findIndex((candidate) => candidate.fileId === attachment.fileId) ===
      index,
  );

  // Composer uploads carry their URLs; modal extras carry trusted File ids and
  // are resolved above. Both become the same recorded attachment shape here.
  const attachments = await Promise.all(
    requestedAttachments.map((attachment) =>
      toEmailAttachment({
        url: attachment.url,
        filename: attachment.name,
        fileType: "application/octet-stream",
      }),
    ),
  );
  const body =
    input.bodyFormat === "html"
      ? sanitizeLeadNotesHtml(input.body)
      : `<p>${escapeEmailHtml(input.body).replace(/\n/g, "<br/>")}</p>`;

  if (outreach.lastInboundMessageId) {
    await client.replyToMessage({
      messageId: outreach.lastInboundMessageId,
      body,
      attachments,
      to: outreach.contactEmail,
      cc: config.cc,
    });
  } else {
    await client.sendMail({
      to: outreach.contactEmail,
      subject,
      body,
      cc: config.cc,
      attachments,
    });
  }

  await recordOutboundEmail({
    engagementId: engagement.id,
    outreachId: outreach.id,
    graphMailbox: outreach.graphMailbox,
    emailFrom: config.senderUpn ?? "",
    emailTo: outreach.contactEmail,
    subject,
    body,
    attachments: requestedAttachments,
  });

  after(() => revalidateEngagement(projectId));

  return requireEngagement(projectId);
}
