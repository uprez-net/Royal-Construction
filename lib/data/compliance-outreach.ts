"use server";

import {
  CertifierEmailDirection,
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
  Prisma,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  complianceDocumentLabel,
  documentTypesForParty,
  PARTY_LABEL,
  PARTY_OUTREACH_ATTACHMENTS,
  PARTY_PREREQUISITES,
} from "@/constants/complianceDocuments";
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
  isPartyEngaged,
  outreachForParty,
  type CertifierEmailAttachment,
  type CertifierEngagementDetail,
} from "@/types/compliance";
import { normalizeEmailAddress } from "@/utils/formatters";
import { generateEmailChecksum } from "@/utils/generator";
import type { StartPartyOutreachInput } from "@/utils/validators/compliance";
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
 * The architect and the council both wait on the surveyor, and they wait on the
 * documents rather than on the mail: a surveyor who has been written to but has
 * sent nothing back leaves an architect with nothing to draw against. The one
 * exception is the outreach existing at all in SELF_SUPPLIED mode, which is
 * already the documents being present -- the client brought them.
 *
 * Returns the reason rather than a boolean so the caller can say what is
 * missing instead of refusing without explanation.
 */
export async function partyPrerequisiteFailure(
  engagement: CertifierEngagementDetail,
  party: CompliancePartyType,
): Promise<string | null> {
  for (const prerequisite of PARTY_PREREQUISITES[party]) {
    if (!isPartyEngaged(engagement, prerequisite)) {
      return `The ${PARTY_LABEL[prerequisite].toLowerCase()} has not been engaged yet.`;
    }

    const outstanding = documentTypesForParty(prerequisite).filter(
      (type) =>
        !engagement.documents.some(
          (document) =>
            document.documentType === type && document.files.length > 0,
        ),
    );
    if (outstanding.length > 0) {
      return `Still waiting on ${outstanding
        .map((type) => complianceDocumentLabel(type))
        .join(", ")} from the ${PARTY_LABEL[prerequisite].toLowerCase()}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Opening an outreach
// ---------------------------------------------------------------------------

/**
 * The outreach body.
 *
 * Plain and short, matching `outreachBody` in lib/data/compliance.ts: whatever
 * is being asked for is attached or listed, the subject already carries the
 * address, and a branded template would only bury the reference line the whole
 * correlation depends on.
 *
 * What each party is asked for comes from the document sections rather than
 * being written out per party, so a document moving between sections cannot
 * leave the mail asking the wrong person for it.
 */
function partyOutreachBody(
  party: CompliancePartyType,
  contactName: string | null,
  subjectAddress: string,
  note: string | null,
): string {
  const greeting = contactName ? `Hi ${contactName},` : "Hi,";
  const wanted = documentTypesForParty(party).map((type) =>
    complianceDocumentLabel(type),
  );

  return [
    `<p>${greeting}</p>`,
    `<p>We are starting work at <strong>${escapeEmailHtml(subjectAddress)}</strong> and would like to engage you on it.</p>`,
    "<p>Could you prepare and send through:</p>",
    `<ul>${wanted.map((label) => `<li>${escapeEmailHtml(label)}</li>`).join("")}</ul>`,
    note ? `<p>${escapeEmailHtml(note)}</p>` : "",
    "<p>Anything you need to work from is attached.</p>",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ]
    .filter(Boolean)
    .join("\n");
}

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

  const contactEmail = normalizeEmailAddress(input.contactEmail);
  const contact = {
    tradieId: input.tradieId ?? null,
    contactName: input.contactName ?? null,
    contactEmail,
    contactPhone: input.contactPhone ?? null,
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
          ...contact,
        },
      });

  // What this party is given to work from. The surveyor's deed was uploaded in
  // the modal moments ago and the architect's set is whatever the surveyor
  // produced -- both resolved off the document rows rather than passed in, so
  // the mail carries the current copy of each rather than whatever the client
  // happened to be looking at.
  const attachmentTypes = new Set<ComplianceDocumentType>(
    PARTY_OUTREACH_ATTACHMENTS[party],
  );
  const files = engagement.documents
    .filter((document) => attachmentTypes.has(document.documentType))
    .flatMap((document) => document.files);

  const config = getGraphConfig();
  const client = await createGraphContext(config);
  const subject = buildPartySubject(
    outreach.refToken,
    engagement.subjectAddress,
  );
  const body = partyOutreachBody(
    party,
    outreach.contactName,
    engagement.subjectAddress,
    input.note ?? null,
  );

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
    data: { status: ComplianceOutreachStatus.SENT },
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
  input: { body: string; attachments: CertifierEmailAttachment[] },
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

  const config = getGraphConfig();
  const client = await createGraphContext(config);
  const subject = buildPartySubject(
    outreach.refToken,
    engagement.subjectAddress,
  );

  // Attached from the urls the composer uploaded to, not from ids: the message
  // may carry a file that belongs to no compliance document at all.
  const attachments = await Promise.all(
    input.attachments.map((attachment) =>
      toEmailAttachment({
        url: attachment.url,
        filename: attachment.name,
        fileType: "application/octet-stream",
      }),
    ),
  );
  const body = `<p>${escapeEmailHtml(input.body).replace(/\n/g, "<br/>")}</p>`;

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
    emailFrom: config.senderUpn ?? "",
    emailTo: outreach.contactEmail,
    subject,
    body,
    attachments: input.attachments,
  });

  after(() => revalidateEngagement(projectId));

  return requireEngagement(projectId);
}

/**
 * Asks the surveyor for a fresh title search.
 *
 * The one-click answer to a STALE_TITLE_SEARCH alert. It exists because the
 * chase is otherwise a message somebody has to compose from scratch, quoting
 * two lists of names off a screen — and the thing being asked for is entirely
 * mechanical, so the mail can say it better than a hurried paraphrase will.
 *
 * Deliberately not a `resolve`. Asking is not fixing: the alert stays open
 * until a replacement lands and the owner check passes, which closes it on its
 * own. What this does is send the request and record it on the thread.
 *
 * Rides the surveyor's existing thread, so the reply carries the token and
 * files itself back against this job.
 */
export async function requestUpdatedTitleSearch(
  projectId: string,
  alertId: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);

  const alert = engagement.alerts.find(
    (candidate) => candidate.id === alertId,
  );
  if (!alert || alert.type !== ComplianceAlertType.STALE_TITLE_SEARCH) {
    throw new Error("No open title search alert on this compliance file.");
  }
  if (alert.status !== ComplianceAlertStatus.OPEN) {
    throw new Error("That alert has already been closed.");
  }

  const outreach = outreachForParty(engagement, CompliancePartyType.SURVEYOR);
  if (!outreach?.contactEmail) {
    // A client-supplied file has no surveyor to write to. Refused with the
    // reason rather than silently doing nothing, because the fix is a person
    // going to whoever actually supplied the document.
    throw new Error(
      "No surveyor has been engaged on this job — the title search will have to be re-ordered by hand.",
    );
  }

  const greeting = outreach.contactName ? `Hi ${outreach.contactName},` : "Hi,";
  const body = [
    `<p>${greeting}</p>`,
    `<p>The title search on file for <strong>${escapeEmailHtml(engagement.subjectAddress)}</strong> does not name the current owners.</p>`,
    // The alert's own detail, which is the comparison that produced it: what
    // the register says against what we hold. Quoted rather than restated, so
    // the surveyor is looking at exactly what we are.
    alert.detail ? `<p>${escapeEmailHtml(alert.detail)}</p>` : "",
    "<p>Could you re-order the search and send the updated copy through? The land registry has most likely not been updated since settlement.</p>",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ]
    .filter(Boolean)
    .join("\n");

  const config = getGraphConfig();
  const client = await createGraphContext(config);
  const subject = buildPartySubject(
    outreach.refToken,
    engagement.subjectAddress,
  );

  if (outreach.lastInboundMessageId) {
    await client.replyToMessage({
      messageId: outreach.lastInboundMessageId,
      body,
      attachments: [],
      to: outreach.contactEmail,
      cc: config.cc,
    });
  } else {
    await client.sendMail({
      to: outreach.contactEmail,
      subject,
      body,
      cc: config.cc,
      attachments: [],
    });
  }

  await recordOutboundEmail({
    engagementId: engagement.id,
    outreachId: outreach.id,
    emailFrom: config.senderUpn ?? "",
    emailTo: outreach.contactEmail,
    subject,
    body,
    attachments: [],
  });

  after(() => revalidateEngagement(projectId));

  return requireEngagement(projectId);
}
