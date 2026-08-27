import type { GraphAttachmentMetadata } from './client';
import { withGraphRetry } from './retry';
import { isOcrConfigured, ocrFile, type OcrInput } from '@/lib/ocr';

/**
 * An attachment prepared for the lead extractor.
 *
 * Split by how the model has to receive it. Most files arrive as `text`: OCR
 * reduces a plan set or a brief to characters far cheaper than shipping the
 * binary, and text formats are simply decoded. `file` is the fallback for what
 * OCR could not read — a site photo, a plan that is pure linework — where the
 * model has to look at the thing itself.
 */
export type LeadAttachment =
  | { kind: 'file'; name: string; mediaType: string; data: Buffer }
  | { kind: 'text'; name: string; text: string };

export interface SkippedAttachment {
  name: string;
  reason: string;
}

/**
 * A file as it came off the mailbox, before anything was made of it.
 *
 * Kept whole and separate from `attachments` because what the extractor needs
 * and what the lead should keep are different things: OCR reduces a plan set to
 * text for the model, and a .docx OCR could not read is dropped from the prompt
 * entirely — but the client still sent both, and both belong on the record.
 */
export interface DownloadedAttachment {
  name: string;
  mediaType: string;
  data: Buffer;
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
  /** Every file whose bytes we hold, for archiving against the saved lead. */
  downloaded: DownloadedAttachment[];
}

export const EMPTY_LEAD_ATTACHMENTS: LeadAttachmentSet = {
  names: [],
  attachments: [],
  skipped: [],
  downloaded: [],
};

const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface MediaSupport {
  /**
   * How the file goes to OCR: as a document to be unpacked and parsed, as a
   * still image, or not at all when its bytes are already characters.
   */
  ocr: 'document' | 'image' | null;
  /**
   * Whether the model can read the raw bytes itself. This is the fallback when
   * OCR comes back empty — and for a format the model cannot take, the only
   * alternative to OCR is dropping the file.
   */
  agent: boolean;
}

// Every format worth carrying, and what can be done with each. Anything absent
// is filtered out before it is downloaded: the model rejects an unknown binary
// rather than ignoring it, so an unfiltered .dwg would fail the whole call.
const SUPPORTED_MEDIA: Record<string, MediaSupport> = {
  'application/pdf': { ocr: 'document', agent: true },
  // Word has no fallback — Gemini cannot open a .docx, so if OCR returns
  // nothing there is nothing left to try.
  [DOCX_MEDIA_TYPE]: { ocr: 'document', agent: false },
  'image/png': { ocr: 'image', agent: true },
  'image/jpeg': { ocr: 'image', agent: true },
  'image/webp': { ocr: 'image', agent: true },
  'image/heic': { ocr: 'image', agent: true },
  'image/heif': { ocr: 'image', agent: true },
  // Already text; OCR would be a round-trip to be told what we can read.
  'text/plain': { ocr: null, agent: false },
  'text/csv': { ocr: null, agent: false },
  'text/markdown': { ocr: null, agent: false },
};

// Outlook sends plenty of attachments as application/octet-stream, and a web
// form's mail relay is worse — the declared type is a hint, the extension is
// what the sender actually chose.
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: DOCX_MEDIA_TYPE,
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

// OCR over a photo of a backyard returns a stray character off a letterbox or
// a number plate. Below this the result is noise, and the image is better read
// by the model that can actually see it.
const MIN_OCR_TEXT_CHARS = 20;

// One slow scan should not eat the invocation. Matches lib/workflow/project.ts,
// where the same OCR endpoint is given the same budget.
const OCR_TIMEOUT_MS = 75_000;

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
    if (!SUPPORTED_MEDIA[mediaType]) {
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

type PreparedAttachment =
  | { ok: true; attachment: LeadAttachment }
  | { ok: false; reason: string };

/** Injectable so the OCR-shaped decisions below can be tested without Mistral. */
export type OcrReader = (input: OcrInput) => Promise<string>;

const mistralOcrReader: OcrReader = async (input) => {
  if (!isOcrConfigured()) {
    console.warn(`  MISTRAL_AI_KEY is not set; skipping OCR for "${input.name}".`);
    return '';
  }

  return ocrFile(input);
};

/**
 * Reads a file through OCR, returning empty for anything that is not usable
 * text.
 *
 * Never throws: OCR being down, unconfigured, or slow is a reason to fall back
 * to the model, not to lose the attachment.
 */
async function readWithOcr(
  reader: OcrReader,
  name: string,
  mediaType: string,
  data: Buffer,
  isImage: boolean,
): Promise<string> {
  try {
    const text = await reader({
      name,
      mediaType,
      data,
      isImage,
      timeoutMs: OCR_TIMEOUT_MS,
    });
    const trimmed = text.trim();
    return trimmed.length >= MIN_OCR_TEXT_CHARS ? trimmed : '';
  } catch (error) {
    console.error(`  OCR failed for "${name}":`, error);
    return '';
  }
}

/**
 * Turns downloaded bytes into something the extractor can use.
 *
 * OCR first: a plan set or a written brief reduces to text far cheaper than
 * shipping the binary to the model, and it is the only way to read a .docx at
 * all. What OCR cannot read — a site photo, a plan that is pure linework —
 * falls back to the model, which can look at it. A format the model cannot
 * take either is dropped, its name still reaching the prompt.
 */
async function prepareAttachment(
  metadata: GraphAttachmentMetadata,
  data: Buffer,
  ocr: OcrReader,
): Promise<PreparedAttachment> {
  const mediaType = resolveMediaType(metadata.name, metadata.contentType);
  const support = SUPPORTED_MEDIA[mediaType];

  if (!support) {
    return { ok: false, reason: `unreadable format ${mediaType || 'unknown'}` };
  }

  if (support.ocr === null) {
    return {
      ok: true,
      attachment: {
        kind: 'text',
        name: metadata.name,
        text: data.toString('utf8').slice(0, MAX_TEXT_CHARS),
      },
    };
  }

  const text = await readWithOcr(
    ocr,
    metadata.name,
    mediaType,
    data,
    support.ocr === 'image',
  );

  if (text) {
    return {
      ok: true,
      attachment: { kind: 'text', name: metadata.name, text: text.slice(0, MAX_TEXT_CHARS) },
    };
  }

  if (support.agent) {
    return {
      ok: true,
      attachment: { kind: 'file', name: metadata.name, mediaType, data },
    };
  }

  return { ok: false, reason: 'no text found and the model cannot open the format' };
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
  ocr: OcrReader = mistralOcrReader,
): Promise<LeadAttachmentSet> {
  if (!messageId) {
    return EMPTY_LEAD_ATTACHMENTS;
  }

  let metadata: GraphAttachmentMetadata[];
  try {
    metadata = await withGraphRetry(`attachments of ${messageId}`, () =>
      source.listMessageAttachments(messageId),
    );
  } catch (error) {
    console.error(`  Failed to list attachments for message ${messageId}:`, error);
    return EMPTY_LEAD_ATTACHMENTS;
  }

  if (metadata.length === 0) {
    return EMPTY_LEAD_ATTACHMENTS;
  }

  const { selected, skipped } = selectLeadAttachments(metadata);
  const attachments: LeadAttachment[] = [];
  const downloaded: DownloadedAttachment[] = [];

  for (const item of selected) {
    try {
      // Per file, so one throttled download does not cost the others their
      // attempts — and a file that is genuinely gone is skipped on its own.
      const data = await withGraphRetry(`download ${item.name}`, () =>
        source.downloadMessageAttachment(messageId, item.id),
      );

      // Recorded before the file is interpreted. Whether OCR could read it, and
      // whether the model ends up seeing it, has no bearing on the client
      // having sent it — the lead keeps the file either way.
      downloaded.push({
        name: item.name,
        mediaType: resolveMediaType(item.name, item.contentType),
        data,
      });

      const prepared = await prepareAttachment(item, data, ocr);
      if (prepared.ok) {
        attachments.push(prepared.attachment);
      } else {
        skipped.push({ name: item.name, reason: prepared.reason });
      }
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
    downloaded,
  };
}
