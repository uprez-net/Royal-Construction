import { CertifierEmailDirection, Prisma } from "@prisma/client";

import { createGraphContext, type EmailAttachment } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { buildPartySubject } from "@/lib/graph/party-subject";
import prisma from "@/lib/prisma";
import { SYDNEY_TZ } from "@/lib/dates/sydney";
import type {
  CertifierEmailAttachment,
  CertifierEngagementDetail,
  ComplianceOutreachDetail,
} from "@/types/compliance";
import { normalizeEmailAddress } from "@/utils/formatters";
import { generateEmailChecksum } from "@/utils/generator";

/**
 * Sending on a party thread, in one place.
 *
 * Four things now write to one of these threads — the opening outreach, a
 * message from the composer, a meeting invitation, and a follow-up chasing
 * something overdue — and every one of them has the same three parts: reply
 * against the last inbound message where there is one, fall back to a
 * subject-threaded send where there is not, and record what went out under the
 * same checksum every other path into that table uses.
 *
 * That was two copies when there were two callers, which was defensible. At
 * four it is not: the reply-versus-send decision is subtle (Graph will not set
 * In-Reply-To through internetMessageHeaders, so a plain send threads on the
 * subject alone and comes apart the moment a client normalises it), and the
 * checksum is what stops an outbound copy coming back around through the
 * mailbox subscription and being re-filed as inbound.
 */

/** Escapes a value for the plain HTML bodies these mails are built from. */
export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A date and time as the people reading it will experience it.
 *
 * Sydney, explicitly. Every recipient of these mails is on the job site or
 * within an hour of it, and the server is on UTC — a meeting invitation that
 * says 11pm for a 9am appointment is worse than no invitation.
 */
export function sydneyMeetingTime(value: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

/**
 * Reads a blob back into the base64 Graph wants.
 *
 * Fetched at send time rather than carried around: blob storage is already
 * durable, and a survey set runs to tens of megabytes that have no business
 * sitting in memory longer than the request that sends them.
 */
export async function toEmailAttachment(file: {
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
 * The stored files behind a list of ids the sender picked by hand.
 *
 * The gate on the "attach something else" control every party modal now has.
 * Ids come in and File rows go out, which is the whole of the check: a caller
 * who could name a url could put anything on the storage account onto an
 * outbound email, and a caller who could name a filename could make a covenant
 * schedule arrive called "survey.pdf".
 *
 * Scoped to the project the engagement belongs to, so an id lifted from another
 * job resolves to nothing rather than to somebody else's document. A file that
 * has been attached to a compliance document on this engagement counts as the
 * project's too -- that is where every uploaded compliance document lives.
 *
 * Missing ids are dropped rather than thrown on. A file deleted between the
 * modal opening and the send is a mail one attachment short, which is visible
 * on the thread and can be sent again; refusing the whole send would lose the
 * message as well.
 */
export async function resolveExtraAttachments(
  projectId: string,
  fileIds: readonly string[],
): Promise<ResolvedAttachment[]> {
  if (fileIds.length === 0) return [];

  const files = await prisma.file.findMany({
    where: {
      id: { in: [...fileIds] },
      OR: [
        { projectId },
        { complianceDocument: { engagement: { projectId } } },
      ],
    },
    select: { id: true, filename: true, url: true, fileType: true },
  });

  // Back into the order they were picked in, so the mail lists them the way the
  // sender arranged them rather than the way Postgres returned them.
  const byId = new Map(files.map((file) => [file.id, file]));
  return fileIds
    .map((id) => byId.get(id))
    .filter((file): file is ResolvedAttachment => Boolean(file));
}

/** Exactly what a send needs off a File row, and nothing else. */
export type ResolvedAttachment = {
  id: string;
  filename: string;
  url: string;
  fileType: string;
};

/**
 * Records a message this system sent on a party thread.
 *
 * The checksum is the dedup key every other path into this table uses, so an
 * outbound copy that comes back around through the mailbox subscription lands
 * on the row already here instead of duplicating the bubble.
 */
export async function recordOutboundPartyEmail(params: {
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

/**
 * Sends one message on a party's thread and records it.
 *
 * `alsoTo` is for the one case that is not a two-party conversation: a meeting
 * between the client and the architect, which both of them have to receive. It
 * rides the architect's thread rather than opening a second one, so a client
 * who hits reply lands on the thread the meeting is actually about — which is
 * what somebody reading the file later wants, and the alternative is a
 * conversation about this job in a place nothing on this job can see.
 *
 * Throws if the outreach has no address. Callers reach this having already
 * decided there is somebody to write to; a send that silently does nothing
 * would leave a meeting recorded as invited that nobody was invited to.
 */
export async function sendOnPartyThread(params: {
  engagement: Pick<CertifierEngagementDetail, "id" | "subjectAddress">;
  outreach: Pick<
    ComplianceOutreachDetail,
    "id" | "refToken" | "contactEmail" | "lastInboundMessageId"
  >;
  body: string;
  /** Extra recipients on the same message — the client, for a meeting. */
  alsoTo?: readonly string[];
  attachments?: readonly CertifierEmailAttachment[];
}): Promise<void> {
  const { engagement, outreach } = params;
  if (!outreach.contactEmail) {
    throw new Error(
      "There is no address on this thread — nothing was sent to them from here.",
    );
  }

  const config = getGraphConfig();
  const client = await createGraphContext(config);
  const subject = buildPartySubject(
    outreach.refToken,
    engagement.subjectAddress,
  );

  const extra = (params.alsoTo ?? [])
    .map((address) => normalizeEmailAddress(address))
    .filter((address) => address && address !== outreach.contactEmail);
  const recipients = [outreach.contactEmail, ...extra];

  const attachments = await Promise.all(
    (params.attachments ?? []).map((attachment) =>
      toEmailAttachment({
        url: attachment.url,
        filename: attachment.name,
        fileType: "application/octet-stream",
      }),
    ),
  );

  if (outreach.lastInboundMessageId) {
    await client.replyToMessage({
      messageId: outreach.lastInboundMessageId,
      body: params.body,
      attachments,
      to: recipients,
      cc: config.cc,
    });
  } else {
    await client.sendMail({
      to: recipients,
      subject,
      body: params.body,
      cc: config.cc,
      attachments,
    });
  }

  await recordOutboundPartyEmail({
    engagementId: engagement.id,
    outreachId: outreach.id,
    emailFrom: config.senderUpn ?? "",
    // The thread's own party, not the whole recipient list. The trail is a
    // conversation with them; a client copied on one message is on that
    // message, not a second correspondent on the thread.
    emailTo: outreach.contactEmail,
    subject,
    body: params.body,
    attachments: [...(params.attachments ?? [])],
  });
}
