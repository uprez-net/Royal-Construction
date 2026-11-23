import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import { isSignatureNoise } from "../email/attachment-noise";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import type { BlobPutPort } from "../ports/blob";
import type { DomainPrincipal } from "../principal";
import { isMachineGenerated } from "@/lib/graph/offer-reply-classify";
import { buildBlobPath, normalizeEmailAddress } from "@/utils/formatters";
import type { EmailHeaders } from "@/utils/spam-detector";

// The client's reply to an Offer-document send, recorded whole: the timestamps
// on the send, the message itself, and blob copies of what they attached. The
// offer is negotiated over email, so without the message the activity panel
// could only say "the client replied" and send the office to the mailbox to
// find out what about.

export type OfferReplyOutcome =
  | "recorded"
  | "already-recorded"
  | "no-matching-send"
  | "auto-generated"
  | "sender-mismatch";

/** The inbound message, flattened to what the rule reads. */
export type InboundOfferReply = {
  /** The [RCOFR-…] token the webhook found in the subject. */
  readonly token: string;
  readonly graphMessageId: string;
  readonly from: string;
  readonly subject: string;
  /** Plain text; the Graph client asks for outlook.body-content-type="text". */
  readonly body: string;
  readonly receivedAt: string | null;
  /** Graph's hint. False when the only attachments are inline, so never the gate. */
  readonly hasAttachments: boolean;
  readonly headers: EmailHeaders;
};

/** One attachment on the message, without its bytes. */
export type InboundAttachmentMetadata = {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly isInline: boolean;
  readonly contentId?: string | null;
  readonly odataType: string;
};

/** The mailbox the reply sits in, scoped to that one message. */
export type OfferReplyMailPort = {
  listAttachments(): Promise<readonly InboundAttachmentMetadata[]>;
  downloadAttachment(attachmentId: string): Promise<Buffer | Uint8Array>;
};

/** What is stored in OfferDocumentReply.attachments, one per file. */
export type OfferReplyAttachment = {
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  /** Null when the file was not stored; `note` then says why. */
  readonly url: string | null;
  readonly note: string | null;
};

const FILE_ATTACHMENT_ODATA_TYPE = "#microsoft.graph.fileAttachment";

// Past this a file is a video or a CAD bundle. It stays in the mailbox and the
// panel says so, rather than holding a workflow step on the upload.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// A reply carrying more than this is a document dump; the rest are listed with
// a note instead of stored.
const MAX_STORED_ATTACHMENTS = 20;

// Written by the plan and cleared once the upload lands, so a run that
// dies part-way leaves a file that reads as missing rather than one that reads
// as never sent.
const NOT_STORED_NOTE = "Not saved — open the email in Outlook to get it.";

// On the row from the moment it is written, until the attachment workflow has
// listed the files. If that workflow never runs, this is what the office reads.
const PENDING_NOTE =
  "Still being saved — refresh shortly. If this stays, open the email in Outlook.";

export type OfferReplyRecord =
  | { readonly outcome: "recorded"; readonly replyId: string }
  | { readonly outcome: Exclude<OfferReplyOutcome, "recorded"> };

/**
 * Records an inbound reply against its OfferDocumentSend.
 *
 * Only a message genuinely sent BY the address we sent TO counts. A reply from
 * an alias is therefore missed, which is the intended trade: repliedAt is the
 * one signal that can ever prove the client received the offer, so a false
 * negative (invisible) beats a false positive (actively wrong). Before that
 * guard existed, a bounce stamped repliedAt — recording "the client replied"
 * for an offer that never arrived.
 *
 * Writes the message and the send's timestamps in one transaction, and
 * nothing else. The attachments are the slow, failure-prone half, so they are
 * left to `planOfferReplyAttachments` and `storeOfferReplyAttachment`, which
 * the adapter runs durably once this has committed.
 */
export async function recordOfferReply(
  principal: DomainPrincipal,
  input: InboundOfferReply,
  db: TransactionalDomainDb,
): Promise<OfferReplyRecord> {
  requireMailboxIntegration(principal);

  const send = await db.offerDocumentSend.findUnique({
    where: { trackedLinkToken: input.token },
    select: { id: true, recipientEmail: true },
  });
  if (!send) {
    return { outcome: "no-matching-send" };
  }

  if (isMachineGenerated(input.headers)) {
    return { outcome: "auto-generated" };
  }

  const sender = normalizeEmailAddress(input.from ?? "");
  const recipient = normalizeEmailAddress(send.recipientEmail);
  if (!sender || !recipient || sender !== recipient) {
    return { outcome: "sender-mismatch" };
  }

  // Graph can notify twice for one message. The first run owns it.
  const existing = await db.offerDocumentReply.findUnique({
    where: { graphMessageId: input.graphMessageId },
    select: { id: true },
  });
  if (existing) {
    return { outcome: "already-recorded" };
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();

  const pending: OfferReplyAttachment[] = input.hasAttachments
    ? [
        {
          contentType: "",
          name: "Attachments",
          note: PENDING_NOTE,
          size: 0,
          url: null,
        },
      ]
    : [];

  try {
    // One transaction, so a failed timestamp write takes the row with it and
    // the next notification for this message records both rather than finding
    // the row and stopping.
    const replyId = await db.$transaction(async (tx) => {
      // The same email in both watched mailboxes (a client reply-all that
      // copies admin@ as well as info@) arrives as two messages with two Graph
      // ids, which the lookup above cannot tie together. The same sender,
      // subject and body for this send within the hour is that message again,
      // not a second reply: recording it would show the client twice and store
      // its files twice (#585). Checked under a lock on the send, because the
      // two notifications can be processed at the same moment and the unique
      // index cannot see them as the same row.
      //
      // Only for a message with no attachments: the text alone cannot tell a
      // copy from a second reply that attaches a different file, and dropping
      // that would lose the file. A reply-all that carries a file is recorded
      // once per mailbox, as it was before admin@ was watched.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`offer-reply:${send.id}`}, 0))`;
      const copy = input.hasAttachments
        ? null
        : await tx.offerDocumentReply.findFirst({
            select: { id: true },
            where: {
              body: input.body,
              fromEmail: sender,
              receivedAt: {
                gte: new Date(receivedAt.getTime() - 60 * 60 * 1000),
                lte: new Date(receivedAt.getTime() + 60 * 60 * 1000),
              },
              sendId: send.id,
              subject: input.subject,
            },
          });
      if (copy) return null;

      const reply = await tx.offerDocumentReply.create({
        data: {
          attachments: pending as unknown as Prisma.InputJsonValue,
          body: input.body,
          fromEmail: sender,
          graphMessageId: input.graphMessageId,
          receivedAt,
          sendId: send.id,
          subject: input.subject,
        },
        select: { id: true },
      });

      // Decided by the database against the row as it stands, not against
      // what was read above: two replies processed out of order must still
      // leave the earliest in repliedAt and the latest in lastReplyAt.
      await tx.offerDocumentSend.updateMany({
        where: {
          id: send.id,
          OR: [{ repliedAt: null }, { repliedAt: { gt: receivedAt } }],
        },
        data: { repliedAt: receivedAt },
      });
      await tx.offerDocumentSend.updateMany({
        where: {
          id: send.id,
          OR: [{ lastReplyAt: null }, { lastReplyAt: { lt: receivedAt } }],
        },
        data: { lastReplyAt: receivedAt },
      });

      return reply.id;
    });
    if (replyId === null) return { outcome: "already-recorded" };
    return { outcome: "recorded", replyId };
  } catch (error) {
    // The duplicate notification that lost the race to the one above.
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return { outcome: "already-recorded" };
    }
    throw error;
  }
}

/** One file the attachment workflow will download and store. */
export type PlannedReplyAttachment = {
  /** Position in the reply's attachment list, which the upload overwrites. */
  readonly index: number;
  readonly attachmentId: string;
  readonly name: string;
  readonly contentType: string;
};

/** Everything the store step needs, plain data so a workflow can carry it. */
export type OfferReplyAttachmentPlan = {
  readonly replyId: string;
  readonly offerId: string;
  readonly graphMessageId: string;
  readonly files: readonly PlannedReplyAttachment[];
};

/**
 * Lists the reply's attachments onto its row and says which to store.
 *
 * Signature logos are dropped from the list entirely; everything else the
 * client sent is listed, stored or not, so the panel never hides a file. A
 * file to be stored is written with NOT_STORED_NOTE, which the store step
 * clears — so a file whose upload never lands reads as missing.
 */
export async function planOfferReplyAttachments(
  principal: DomainPrincipal,
  input: { readonly replyId: string },
  db: DomainDb,
  ports: { readonly mail: OfferReplyMailPort },
): Promise<OfferReplyAttachmentPlan> {
  requireMailboxIntegration(principal);

  const reply = await db.offerDocumentReply.findUnique({
    where: { id: input.replyId },
    select: { graphMessageId: true, send: { select: { offerId: true } } },
  });
  if (!reply) {
    throw new DomainNotFoundError("That offer reply is no longer on file.");
  }

  const files: PlannedReplyAttachment[] = [];
  const listed: OfferReplyAttachment[] = [];
  try {
    for (const attachment of await ports.mail.listAttachments()) {
      // The client's signature, not something they sent us.
      if (isSignatureNoise(attachment)) {
        continue;
      }
      const base = {
        contentType: attachment.contentType,
        name: attachment.name || "Attachment",
        size: attachment.size,
        url: null,
      };
      if (attachment.odataType !== FILE_ATTACHMENT_ODATA_TYPE) {
        listed.push({
          ...base,
          note: "A forwarded email or cloud link — open the email in Outlook.",
        });
      } else if (attachment.size > MAX_ATTACHMENT_BYTES) {
        listed.push({
          ...base,
          note: `Too large to save here (${formatMegabytes(attachment.size)}) — open the email in Outlook.`,
        });
      } else if (files.length >= MAX_STORED_ATTACHMENTS) {
        listed.push({
          ...base,
          note: `Only the first ${MAX_STORED_ATTACHMENTS} files are saved — open the email in Outlook.`,
        });
      } else {
        files.push({
          attachmentId: attachment.id,
          contentType: attachment.contentType,
          index: listed.length,
          name: base.name,
        });
        listed.push({ ...base, note: NOT_STORED_NOTE });
      }
    }
  } catch (error) {
    // The Graph port already retried the transient kind. Said on the row
    // rather than left on the pending note, which promises a result.
    console.error(
      `  Couldn't list attachments on offer reply ${reply.graphMessageId}:`,
      error,
    );
    files.length = 0;
    listed.length = 0;
    listed.push({
      contentType: "",
      name: "Attachments",
      note: "Couldn't be read from the mailbox — open the email in Outlook.",
      size: 0,
      url: null,
    });
  }

  await db.offerDocumentReply.update({
    where: { id: input.replyId },
    data: { attachments: listed as unknown as Prisma.InputJsonValue },
  });

  return {
    files,
    graphMessageId: reply.graphMessageId,
    offerId: reply.send.offerId,
    replyId: input.replyId,
  };
}

/**
 * Downloads one planned file, stores it, and links it on the reply.
 *
 * Throws on failure so the caller's retry can run it again: the blob path is
 * derived from the message and the attachment, so a second attempt overwrites
 * its own object instead of orphaning one beside it.
 */
export async function storeOfferReplyAttachment(
  principal: DomainPrincipal,
  input: {
    readonly plan: Omit<OfferReplyAttachmentPlan, "files">;
    readonly file: PlannedReplyAttachment;
  },
  db: DomainDb,
  ports: { readonly mail: OfferReplyMailPort; readonly put: BlobPutPort },
): Promise<{ readonly url: string }> {
  requireMailboxIntegration(principal);
  const { file, plan } = input;

  const data = await ports.mail.downloadAttachment(file.attachmentId);
  const blob = await ports.put({
    allowOverwrite: true,
    body: data,
    contentType: file.contentType || undefined,
    pathname: buildBlobPath({
      fileId: `reply-${deterministicId(plan.graphMessageId, file.attachmentId)}`,
      fileName: file.name,
      offerId: plan.offerId,
    }),
  });

  const reply = await db.offerDocumentReply.findUnique({
    where: { id: plan.replyId },
    select: { attachments: true },
  });
  if (!reply) {
    throw new DomainNotFoundError("That offer reply is no longer on file.");
  }
  const attachments = parseOfferReplyAttachments(reply.attachments);
  const entry = attachments[file.index];
  if (entry?.name === file.name) {
    attachments[file.index] = {
      ...entry,
      note: null,
      size: data.byteLength,
      url: blob.url,
    };
    await db.offerDocumentReply.update({
      where: { id: plan.replyId },
      data: { attachments: attachments as unknown as Prisma.InputJsonValue },
    });
  }
  return { url: blob.url };
}

// Reached only from the Graph webhook and the workflow it starts, whose channel
// authenticated on its client state. Nothing signed in or anonymous records a
// client's reply.
function requireMailboxIntegration(principal: DomainPrincipal): void {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the mailbox integration can record a client's reply.",
    );
  }
}

function deterministicId(graphMessageId: string, attachmentId: string) {
  return createHash("sha256")
    .update(`offer-reply:${graphMessageId}:attachment:${attachmentId}`)
    .digest("hex")
    .slice(0, 32);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reads the stored attachment list back, tolerating a malformed entry rather
 * than failing the whole activity panel over one bad row.
 */
export function parseOfferReplyAttachments(
  value: Prisma.JsonValue,
): OfferReplyAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: OfferReplyAttachment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const { contentType, name, note, size, url } = entry as Record<
      string,
      unknown
    >;
    if (typeof name !== "string") {
      continue;
    }
    attachments.push({
      contentType: typeof contentType === "string" ? contentType : "",
      name,
      note: typeof note === "string" ? note : null,
      size: typeof size === "number" ? size : 0,
      // Rendered as a link, so only ever an https URL — which is all this
      // module writes.
      url: typeof url === "string" && url.startsWith("https://") ? url : null,
    });
  }
  return attachments;
}
