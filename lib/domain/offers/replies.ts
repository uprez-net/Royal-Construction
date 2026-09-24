import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";
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

// Inline attachments are overwhelmingly signature logos and tracking pixels,
// all tiny. A pasted photo or plan is not, so the cut is on size rather than on
// dropping every inline file. Same threshold as lib/graph/lead-attachments.
const MIN_INLINE_BYTES = 40 * 1024;

// Past this a file is a video or a CAD bundle. It stays in the mailbox and the
// panel says so, rather than holding the webhook's invocation on the upload.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// A reply carrying more than this is a document dump; the rest are listed with
// a note instead of stored.
const MAX_STORED_ATTACHMENTS = 20;

// Written with the row and overwritten once the upload lands, so a run that
// dies part-way leaves a file that reads as missing rather than one that reads
// as never sent.
const NOT_STORED_NOTE = "Not saved — open the email in Outlook to get it.";

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
 * The message row is written before any attachment is downloaded. What the
 * client wrote is the part the office cannot do without, and a slow or failed
 * upload must not cost it. Every attachment failure is kept on the row as a
 * note, never thrown: the reply is already recorded by then.
 */
export async function recordOfferReply(
  principal: DomainPrincipal,
  input: InboundOfferReply,
  db: DomainDb,
  ports: { readonly mail: OfferReplyMailPort; readonly put: BlobPutPort },
): Promise<OfferReplyOutcome> {
  // Reached only from the Graph webhook, whose channel authenticated on its
  // client state. Nothing signed in or anonymous records a client's reply.
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the mailbox integration can record a client's reply.",
    );
  }

  const send = await db.offerDocumentSend.findUnique({
    where: { trackedLinkToken: input.token },
    select: { id: true, offerId: true, recipientEmail: true, repliedAt: true },
  });
  if (!send) {
    return "no-matching-send";
  }

  if (isMachineGenerated(input.headers)) {
    return "auto-generated";
  }

  const sender = normalizeEmailAddress(input.from ?? "");
  const recipient = normalizeEmailAddress(send.recipientEmail);
  if (!sender || !recipient || sender !== recipient) {
    return "sender-mismatch";
  }

  // Graph can notify twice for one message. The first run owns it.
  const existing = await db.offerDocumentReply.findUnique({
    where: { graphMessageId: input.graphMessageId },
    select: { id: true },
  });
  if (existing) {
    return "already-recorded";
  }

  const { toStore, listed } = await planAttachments(input, ports.mail);

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  let replyId: string;
  try {
    const reply = await db.offerDocumentReply.create({
      data: {
        attachments: listed as unknown as Prisma.InputJsonValue,
        body: input.body,
        fromEmail: sender,
        graphMessageId: input.graphMessageId,
        receivedAt,
        sendId: send.id,
        subject: input.subject,
      },
      select: { id: true },
    });
    replyId = reply.id;
  } catch (error) {
    // The duplicate notification that lost the race to the one above.
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return "already-recorded";
    }
    throw error;
  }

  await db.offerDocumentSend.update({
    where: { id: send.id },
    data: {
      lastReplyAt: receivedAt,
      ...(send.repliedAt ? {} : { repliedAt: receivedAt }),
    },
  });

  if (toStore.length > 0) {
    const stored = await storeAttachments(
      send.offerId,
      input.graphMessageId,
      toStore,
      listed,
      ports,
    );
    await db.offerDocumentReply.update({
      where: { id: replyId },
      data: { attachments: stored as unknown as Prisma.InputJsonValue },
    });
  }

  return "recorded";
}

type PlannedAttachment = {
  /** Position in `listed`, which the upload result overwrites. */
  readonly index: number;
  readonly metadata: InboundAttachmentMetadata;
};

/**
 * Which attachments to store, and the row's initial description of every one.
 *
 * Signature logos are dropped from the list entirely; everything else the
 * client sent is listed, stored or not, so the panel never hides a file.
 */
async function planAttachments(
  input: InboundOfferReply,
  mail: OfferReplyMailPort,
): Promise<{
  toStore: PlannedAttachment[];
  listed: OfferReplyAttachment[];
}> {
  let metadata: readonly InboundAttachmentMetadata[];
  try {
    metadata = await mail.listAttachments();
  } catch (error) {
    console.error(
      `  Couldn't list attachments on offer reply ${input.graphMessageId}:`,
      error,
    );
    return {
      listed: input.hasAttachments
        ? [
            {
              contentType: "",
              name: "Attachments",
              note: "Couldn't be read from the mailbox — open the email in Outlook.",
              size: 0,
              url: null,
            },
          ]
        : [],
      toStore: [],
    };
  }

  const toStore: PlannedAttachment[] = [];
  const listed: OfferReplyAttachment[] = [];
  for (const attachment of metadata) {
    if (attachment.isInline && attachment.size < MIN_INLINE_BYTES) {
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
    } else if (toStore.length >= MAX_STORED_ATTACHMENTS) {
      listed.push({
        ...base,
        note: `Only the first ${MAX_STORED_ATTACHMENTS} files are saved — open the email in Outlook.`,
      });
    } else {
      toStore.push({ index: listed.length, metadata: attachment });
      listed.push({ ...base, note: NOT_STORED_NOTE });
    }
  }
  return { listed, toStore };
}

async function storeAttachments(
  offerId: string,
  graphMessageId: string,
  toStore: readonly PlannedAttachment[],
  listed: readonly OfferReplyAttachment[],
  ports: { readonly mail: OfferReplyMailPort; readonly put: BlobPutPort },
): Promise<OfferReplyAttachment[]> {
  const result = [...listed];
  for (const { index, metadata } of toStore) {
    try {
      const data = await ports.mail.downloadAttachment(metadata.id);
      const blob = await ports.put({
        // Same message and attachment, same path: a retry overwrites its own
        // object instead of leaving an orphan beside it.
        allowOverwrite: true,
        body: data,
        contentType: metadata.contentType || undefined,
        pathname: buildBlobPath({
          fileId: `reply-${deterministicId(graphMessageId, metadata.id)}`,
          fileName: result[index].name,
          offerId,
        }),
      });
      result[index] = {
        ...result[index],
        note: null,
        size: data.byteLength,
        url: blob.url,
      };
    } catch (error) {
      console.error(
        `  Failed to save offer reply attachment "${metadata.name}":`,
        error,
      );
    }
  }
  return result;
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
