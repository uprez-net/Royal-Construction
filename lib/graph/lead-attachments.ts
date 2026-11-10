import type { GraphAttachmentMetadata } from "./client";
import { isSignatureNoise } from "@/lib/domain/email/attachment-noise";
import { withGraphRetry } from "./retry";
import { isOcrConfigured, ocrFile, type OcrInput } from "@/lib/ocr";

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
  | { kind: "file"; name: string; mediaType: string; data: Buffer }
  | { kind: "text"; name: string; text: string };

export interface SkippedAttachment {
  name: string;
  reason: string;
}

/**
 * One downloaded file, described rather than carried.
 *
 * Deliberately holds no bytes. This crosses workflow step boundaries, where
 * everything is serialized into the run's event log — putting 10 MB of plans
 * through that on every step would be the wrong place to keep a file. The
 * mailbox is already durable storage, so `id` is enough: any step that needs
 * the bytes fetches them again.
 */
export interface LeadAttachmentSummary {
  /** Graph attachment id, so the bytes can be fetched again on demand. */
  id: string;
  name: string;
  mediaType: string;
  size: number;
  /** What OCR read, or null when it found nothing usable. */
  text: string | null;
  /** Whether the model can read the raw bytes when there is no text. */
  modelReadable: boolean;
}

/**
 * What a message's attachments amount to, in a form a step can return.
 *
 * `files` is everything successfully downloaded, whatever became of it: the
 * lead keeps all of them, while only some reach the prompt.
 */
export interface LeadAttachmentReport {
  /**
   * Every attachment the sender put on the message, readable or not. The
   * extractor is told these names even for the files it cannot open, so a lead
   * whose enquiry is "plans attached" reads as an enquiry with plans rather
   * than as an empty message.
   */
  names: string[];
  files: LeadAttachmentSummary[];
  skipped: SkippedAttachment[];
}

export const EMPTY_LEAD_ATTACHMENT_REPORT: LeadAttachmentReport = {
  names: [],
  files: [],
  skipped: [],
};

export interface LeadAttachmentSet {
  names: string[];
  attachments: LeadAttachment[];
  skipped: SkippedAttachment[];
}

export const EMPTY_LEAD_ATTACHMENTS: LeadAttachmentSet = {
  names: [],
  attachments: [],
  skipped: [],
};

const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface MediaSupport {
  /**
   * How the file goes to OCR: as a document to be unpacked and parsed, as a
   * still image, or not at all when its bytes are already characters.
   */
  ocr: "document" | "image" | null;
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
  "application/pdf": { ocr: "document", agent: true },
  // Word has no fallback — the model cannot open a .docx, so if OCR returns
  // nothing there is nothing left to try.
  [DOCX_MEDIA_TYPE]: { ocr: "document", agent: false },
  "image/png": { ocr: "image", agent: true },
  "image/jpeg": { ocr: "image", agent: true },
  "image/webp": { ocr: "image", agent: true },
  "image/heic": { ocr: "image", agent: true },
  "image/heif": { ocr: "image", agent: true },
  // Already text; OCR would be a round-trip to be told what we can read.
  "text/plain": { ocr: null, agent: false },
  "text/csv": { ocr: null, agent: false },
  "text/markdown": { ocr: null, agent: false },
};

// Outlook sends plenty of attachments as application/octet-stream, and a web
// form's mail relay is worse — the declared type is a hint, the extension is
// what the sender actually chose.
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: DOCX_MEDIA_TYPE,
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
};

// A single file this large is a video or a CAD bundle, not something the model
// will read usefully, and it would spend the whole request budget on its own.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Inline file parts are capped per request by the model provider. Stay well
// short of any cap: the body and the prompt ride in the same request.
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

// Past a handful of files an enquiry is a document dump; the first few carry
// the detail and the rest only cost latency.
const MAX_ATTACHMENT_COUNT = 5;

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

const FILE_ATTACHMENT_ODATA_TYPE = "#microsoft.graph.fileAttachment";

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
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

  return (contentType ?? "").split(";")[0].trim().toLowerCase();
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
    const skip = (reason: string) =>
      skipped.push({ name: attachment.name, reason });

    // itemAttachment is a forwarded email and referenceAttachment is a link to
    // OneDrive; neither has bytes behind /$value.
    if (attachment.odataType !== FILE_ATTACHMENT_ODATA_TYPE) {
      skip(`unsupported attachment type ${attachment.odataType || "unknown"}`);
      continue;
    }

    // Signature logos and tracking pixels. Checked before the count and the
    // byte budget so a thread's worth of logos cannot crowd out a document.
    if (isSignatureNoise(attachment)) {
      skip(
        "a signature image or tracking pixel, not something the sender attached",
      );
      continue;
    }

    const mediaType = resolveMediaType(attachment.name, attachment.contentType);
    if (!SUPPORTED_MEDIA[mediaType]) {
      skip(`unreadable format ${mediaType || "unknown"}`);
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
      skip(
        `would take the message past the ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} total limit`,
      );
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
  downloadMessageAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer>;
}

/** Injectable so the OCR-shaped decisions below can be tested without Mistral. */
export type OcrReader = (input: OcrInput) => Promise<string>;

const mistralOcrReader: OcrReader = async (input) => {
  if (!isOcrConfigured()) {
    console.warn(
      `  MISTRAL_AI_KEY is not set; skipping OCR for "${input.name}".`,
    );
    return "";
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
    return trimmed.length >= MIN_OCR_TEXT_CHARS ? trimmed : "";
  } catch (error) {
    console.error(`  OCR failed for "${name}":`, error);
    return "";
  }
}

/**
 * Decides what a downloaded file amounts to.
 *
 * OCR first: a plan set or a written brief reduces to text far cheaper than
 * shipping the binary to the model, and it is the only way to read a .docx at
 * all. What OCR cannot read — a site photo, a plan that is pure linework — is
 * left for the model, which can look at it. A format the model cannot take
 * either has nothing left to try.
 */
async function summarizeAttachment(
  metadata: GraphAttachmentMetadata,
  data: Buffer,
  ocr: OcrReader,
): Promise<LeadAttachmentSummary> {
  const mediaType = resolveMediaType(metadata.name, metadata.contentType);
  const support = SUPPORTED_MEDIA[mediaType];

  const summary: LeadAttachmentSummary = {
    id: metadata.id,
    name: metadata.name,
    mediaType,
    size: data.byteLength,
    text: null,
    modelReadable: support?.agent ?? false,
  };

  if (!support) {
    return summary;
  }

  if (support.ocr === null) {
    return { ...summary, text: data.toString("utf8").slice(0, MAX_TEXT_CHARS) };
  }

  const text = await readWithOcr(
    ocr,
    metadata.name,
    mediaType,
    data,
    support.ocr === "image",
  );

  return text ? { ...summary, text: text.slice(0, MAX_TEXT_CHARS) } : summary;
}

/**
 * Lists a message's attachments, downloads the ones worth reading, and reports
 * what each turned out to be.
 *
 * Bytes are dropped on the way out. This is the expensive half — the downloads
 * and the OCR — and it runs once, as one step; anything that needs the file
 * again fetches it from the mailbox rather than carrying it through the run.
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
): Promise<LeadAttachmentReport> {
  if (!messageId) {
    return EMPTY_LEAD_ATTACHMENT_REPORT;
  }

  let metadata: GraphAttachmentMetadata[];
  try {
    metadata = await withGraphRetry(`attachments of ${messageId}`, () =>
      source.listMessageAttachments(messageId),
    );
  } catch (error) {
    console.error(
      `  Failed to list attachments for message ${messageId}:`,
      error,
    );
    return EMPTY_LEAD_ATTACHMENT_REPORT;
  }

  if (metadata.length === 0) {
    return EMPTY_LEAD_ATTACHMENT_REPORT;
  }

  const { selected, skipped } = selectLeadAttachments(metadata);
  const files: LeadAttachmentSummary[] = [];

  for (const item of selected) {
    try {
      // Per file, so one throttled download does not cost the others their
      // attempts — and a file that is genuinely gone is skipped on its own.
      const data = await withGraphRetry(`download ${item.name}`, () =>
        source.downloadMessageAttachment(messageId, item.id),
      );

      files.push(await summarizeAttachment(item, data, ocr));
    } catch (error) {
      console.error(`  Failed to download attachment "${item.name}":`, error);
      skipped.push({ name: item.name, reason: "download failed" });
    }
  }

  return {
    // Inline signature images are noise in the manifest too — the sender did
    // not "attach" their company logo, Outlook did.
    names: metadata
      .filter((item) => !isSignatureNoise(item))
      .map((item) => item.name),
    files,
    skipped,
  };
}

/**
 * Rebuilds the extractor's view of the attachments, fetching bytes only for the
 * files the model has to look at itself.
 *
 * A file OCR read is already text and needs nothing more. A file OCR could not
 * read, and the model cannot open either, is named in the prompt but not sent —
 * it still reaches the lead record, just not the model.
 */
export async function hydrateLeadAttachments(
  report: LeadAttachmentReport,
  source: LeadAttachmentSource,
  messageId: string,
): Promise<LeadAttachmentSet> {
  const attachments: LeadAttachment[] = [];
  const skipped = [...report.skipped];

  for (const file of report.files) {
    if (file.text !== null) {
      attachments.push({ kind: "text", name: file.name, text: file.text });
      continue;
    }

    if (!file.modelReadable) {
      skipped.push({
        name: file.name,
        reason: "no text found and the model cannot open the format",
      });
      continue;
    }

    try {
      const data = await withGraphRetry(`download ${file.name}`, () =>
        source.downloadMessageAttachment(messageId, file.id),
      );
      attachments.push({
        kind: "file",
        name: file.name,
        mediaType: file.mediaType,
        data,
      });
    } catch (error) {
      console.error(`  Failed to re-read attachment "${file.name}":`, error);
      skipped.push({ name: file.name, reason: "could not be read back" });
    }
  }

  return { names: report.names, attachments, skipped };
}
