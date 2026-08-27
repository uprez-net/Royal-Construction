import type { GraphAttachmentMetadata } from './client';

/**
 * An attachment prepared for the lead extractor.
 *
 * Split by how the model has to receive it. PDFs and photos go up as binary
 * file parts; text formats are decoded here and inlined as text, because a
 * provider's handling of a `text/csv` file part is far less predictable than
 * its handling of the same bytes as characters.
 */
export type LeadAttachment =
  | { kind: 'file'; name: string; mediaType: string; data: Buffer }
  | { kind: 'text'; name: string; text: string };

export interface SkippedAttachment {
  name: string;
  reason: string;
}

export interface LeadAttachmentSet {
  /**
   * Every attachment the sender put on the message, readable or not. The
   * extractor is told these names even for the files it cannot open, so a lead
   * whose enquiry is "plans attached" reads as an enquiry with plans rather
   * than as an empty message.
   */
  names: string[];
  attachments: LeadAttachment[];
  skipped: SkippedAttachment[];
}

export const EMPTY_LEAD_ATTACHMENTS: LeadAttachmentSet = {
  names: [],
  attachments: [],
  skipped: [],
};

// What Gemini accepts as binary input. Anything outside this list is rejected
// by the model rather than ignored, so it is filtered out here instead.
const FILE_MEDIA_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Formats we decode to characters instead of shipping as bytes.
const TEXT_MEDIA_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown']);

// Outlook sends plenty of attachments as application/octet-stream, and a web
// form's mail relay is worse — the declared type is a hint, the extension is
// what the sender actually chose.
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
};

// A single file this large is a video or a CAD bundle, not something the model
// will read usefully, and it would spend the whole request budget on its own.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Gemini rejects an inline request over 20 MB outright. Stop well short of it:
// the body and the prompt ride in the same request.
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

// Past a handful of files an enquiry is a document dump; the first few carry
// the detail and the rest only cost latency.
const MAX_ATTACHMENT_COUNT = 5;

// Inline attachments are overwhelmingly signature logos, social icons and
// tracking pixels — all tiny. A pasted site photo or floor plan is not, so the
// cut is on size rather than on dropping every inline file.
const MIN_INLINE_BYTES = 40 * 1024;

// One decoded text attachment should not be able to crowd the email body out
// of the context window.
const MAX_TEXT_CHARS = 20000;

const FILE_ATTACHMENT_ODATA_TYPE = '#microsoft.graph.fileAttachment';

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * The media type to treat an attachment as, preferring the extension the sender
 * chose over a generic or missing Content-Type.
 */
export function resolveMediaType(name: string, contentType: string): string {
  const fromExtension = EXTENSION_MEDIA_TYPES[extensionOf(name)];
  if (fromExtension) {
    return fromExtension;
  }

  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Decides which of a message's attachments are worth downloading and sending to
 * the extractor.
 *
 * Pure, so the policy can be tested without Graph: the caller downloads only
 * what comes back in `selected`.
 */
export function selectLeadAttachments(metadata: GraphAttachmentMetadata[]): {
  selected: GraphAttachmentMetadata[];
  skipped: SkippedAttachment[];
} {
  const selected: GraphAttachmentMetadata[] = [];
  const skipped: SkippedAttachment[] = [];
  let totalBytes = 0;

  for (const attachment of metadata) {
    const skip = (reason: string) => skipped.push({ name: attachment.name, reason });

    // itemAttachment is a forwarded email and referenceAttachment is a link to
    // OneDrive; neither has bytes behind /$value.
    if (attachment.odataType !== FILE_ATTACHMENT_ODATA_TYPE) {
      skip(`unsupported attachment type ${attachment.odataType || 'unknown'}`);
      continue;
    }

    if (attachment.isInline && attachment.size < MIN_INLINE_BYTES) {
      skip('inline image too small to be anything but a signature or a tracking pixel');
      continue;
    }

    const mediaType = resolveMediaType(attachment.name, attachment.contentType);
    if (!FILE_MEDIA_TYPES.has(mediaType) && !TEXT_MEDIA_TYPES.has(mediaType)) {
      skip(`unreadable format ${mediaType || 'unknown'}`);
      continue;
    }

    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      skip(
        `${formatBytes(attachment.size)} is over the ${formatBytes(MAX_ATTACHMENT_BYTES)} per-file limit`,
      );
      continue;
    }

    if (selected.length >= MAX_ATTACHMENT_COUNT) {
      skip(`over the ${MAX_ATTACHMENT_COUNT} attachment limit for one message`);
      continue;
    }

    if (totalBytes + attachment.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      skip(`would take the message past the ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} total limit`);
      continue;
    }

    totalBytes += attachment.size;
    selected.push(attachment);
  }

  return { selected, skipped };
}

/**
 * The slice of the Graph client this module needs, so the download loop can be
 * tested against a fake.
 */
export interface LeadAttachmentSource {
  listMessageAttachments(messageId: string): Promise<GraphAttachmentMetadata[]>;
  downloadMessageAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

function toLeadAttachment(
  metadata: GraphAttachmentMetadata,
  data: Buffer,
): LeadAttachment {
  const mediaType = resolveMediaType(metadata.name, metadata.contentType);

  if (TEXT_MEDIA_TYPES.has(mediaType)) {
    return {
      kind: 'text',
      name: metadata.name,
      text: data.toString('utf8').slice(0, MAX_TEXT_CHARS),
    };
  }

  return { kind: 'file', name: metadata.name, mediaType, data };
}

/**
 * Lists a message's attachments and downloads the ones worth reading.
 *
 * Never throws. An enquiry with an unreachable attachment is still an enquiry,
 * and losing the lead because Graph refused one file would be worse than
 * extracting from the body alone — so every failure is logged and folded into
 * `skipped`.
 */
export async function collectLeadAttachments(
  source: LeadAttachmentSource,
  messageId: string,
): Promise<LeadAttachmentSet> {
  if (!messageId) {
    return EMPTY_LEAD_ATTACHMENTS;
  }

  let metadata: GraphAttachmentMetadata[];
  try {
    metadata = await source.listMessageAttachments(messageId);
  } catch (error) {
    console.error(`  Failed to list attachments for message ${messageId}:`, error);
    return EMPTY_LEAD_ATTACHMENTS;
  }

  if (metadata.length === 0) {
    return EMPTY_LEAD_ATTACHMENTS;
  }

  const { selected, skipped } = selectLeadAttachments(metadata);
  const attachments: LeadAttachment[] = [];

  for (const item of selected) {
    try {
      const data = await source.downloadMessageAttachment(messageId, item.id);
      attachments.push(toLeadAttachment(item, data));
    } catch (error) {
      console.error(`  Failed to download attachment "${item.name}":`, error);
      skipped.push({ name: item.name, reason: 'download failed' });
    }
  }

  return {
    // Inline signature images are noise in the manifest too — the sender did
    // not "attach" their company logo, Outlook did.
    names: metadata
      .filter((item) => !(item.isInline && item.size < MIN_INLINE_BYTES))
      .map((item) => item.name),
    attachments,
    skipped,
  };
}
