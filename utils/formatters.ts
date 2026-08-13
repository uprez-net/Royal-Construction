import type { DataPoint } from "@/components/common/metric-card";
import type { ProjectStatus, Role, VariationStatus } from "@prisma/client";

/**
 * Formats numeric values as Australian Dollars (AUD).
 *
 * Example:
 * - 1500 → "$1,500"
 */
export const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

/**
 * Formats hourly and unit rates as Australian Dollars (AUD), always with cents.
 *
 * Use this — not {@link currency} — for any figure a person could quote with
 * cents: hourly rates, day rates, per-unit prices. {@link currency} rounds to
 * whole dollars, which is right for budgets and contract values but turns a
 * tradie on $85.50/hr into "$86".
 *
 * Example:
 * - 85.5 → "$85.50"
 * - 120 → "$120.00"
 */
export const rateCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats numeric values as compact Australian Dollars (AUD).
 *
 * Example:
 * - 1500 → "$1.5K"
 * - 1250000 → "$1.3M"
 */
// trailingZeroDisplay is load-bearing, not cosmetic. Without it, Node's ICU and
// the browser's disagree on compact zero — the server rendered "$0.0" and Chrome
// rendered "$0", which threw a hydration error on every dashboard KPI tile. It
// also drops the pointless ".0" from round values ("$25K", not "$25.0K").
export const compactCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  notation: "compact",
  maximumFractionDigits: 1,
  trailingZeroDisplay: "stripIfInteger",
});

/**
 * Formats dates using the Australian locale.
 *
 * Example:
 * - 24 Jun 2026
 */
export const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * Formats dates without the year using the Australian locale.
 *
 * Example:
 * - 24 Jun
 */
export const shortDateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
});

/**
 * Formats date and time values using the Australian locale.
 *
 * Example:
 * - 24 Jun 2026, 09:30 AM
 */
export const dataTimeFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/**
 * Formats time values using the Australian locale.
 *
 * Example:
 * - 09:30 AM
 */
export const timeFormat = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/**
 * Converts a file size in bytes into a human-readable string.
 *
 * Supports units from bytes (B) up to terabytes (TB).
 *
 * @param bytes - File size in bytes.
 * @returns Formatted file size string.
 *
 * @example
 * formatFileSize(1024) // "1 KB"
 * formatFileSize(1536000) // "1.5 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Converts a MIME type into a user-friendly file extension label.
 *
 * Falls back to the MIME subtype when no explicit mapping exists.
 *
 * @param fileType - MIME type string.
 * @returns Display-friendly file type.
 *
 * @example
 * formatFileType("application/pdf") // "PDF"
 * formatFileType("image/png") // "PNG"
 */
export function formatFileType(fileType: string): string {
  // Minify MIME types to common file extensions
  const mapping: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "XLSX",
    "text/csv": "CSV",
  };

  return mapping[fileType] || fileType.split("/").pop()?.toUpperCase() || "FILE";
}

/**
 * Turns a `SCREAMING_SNAKE_CASE` enum value into a display label.
 *
 * Sentence case, not title case. This used to title-case every word
 * ("Needs Attention") while a second, identically-named `formatStatus` in
 * `components/projects/project-status.ts` sentence-cased — two same-named
 * formatters with divergent output, which is exactly the drift this pass exists
 * to remove. Sentence case is the rule for labels, so it won here and the
 * duplicate now re-exports this one.
 *
 * @param status - Status string in SCREAMING_SNAKE_CASE.
 * @returns Formatted status label.
 *
 * @example
 * formatStatus("NEEDS_ATTENTION")
 * // "Needs attention"
 */
export function formatStatus(status: string) {
  return status
    .split("_")
    .map((part, index) =>
      index === 0
        ? part.charAt(0) + part.slice(1).toLowerCase()
        : part.toLowerCase(),
    )
    .join(" ");
}

/**
 * Maps a project status to its corresponding UI tone.
 *
 * @param status - Project status value.
 * @returns Semantic tone used by badges and status indicators.
 */
export function projectStatusTone(status: ProjectStatus) {
  if (status === "ON_TRACK" || status === "COMPLETED") {
    return "success" as const;
  }

  if (status === "NEEDS_ATTENTION") {
    return "warning" as const;
  }

  if (status === "DELAYED") {
    return "danger" as const;
  }

  return "neutral" as const;
}

/**
 * Maps a variation status to its corresponding UI tone.
 *
 * @param status - Variation status value.
 * @returns Semantic tone used by badges and status indicators.
 */
export function variationStatusTone(status: VariationStatus) {
  if (status === "APPROVED") {
    return "success" as const;
  }

  if (status === "REJECTED") {
    return "danger" as const;
  }

  return "warning" as const;
}


/**
 * Replace invalid characters in a filename with dashes and collapse duplicates.
 * @param fileName - original filename
 * @returns sanitized filename safe for use in paths/urls
 */
export function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

interface BlobPathParams {
  fileId: string;
  fileName: string;
  milestoneId?: string;
  projectId?: string;
  leadId?: string;
  offerId?: string;
  tradieId?: string;
}
/**
 * Builds a storage path for uploaded files based on the entity
 * the file belongs to.
 *
 * Supports project, milestone, lead, offer, and tradie file uploads.
 *
 * @param params - Blob path generation parameters.
 * @returns Relative blob storage path.
 *
 * @example
 * buildBlobPath({
 *   fileId: "123",
 *   fileName: "quote.pdf",
 *   projectId: "abc"
 * })
 * // projects/abc/123-quote.pdf
 */
export function buildBlobPath({ fileId, fileName, milestoneId, projectId, leadId, offerId, tradieId }: BlobPathParams) {
  if (milestoneId) {
    return `projects/${projectId ?? "Unknown"}/milestones/${milestoneId}/${fileId}-${sanitizeFileName(fileName)}`;
  }

  if (tradieId) {
    return `tradies/${tradieId}/${fileId}-${sanitizeFileName(fileName)}`;
  }

  if (leadId) {
    return `leads/${leadId}/${fileId}-${sanitizeFileName(fileName)}`;
  }

  if (offerId) {
    return `offers/${offerId}/${fileId}-${sanitizeFileName(fileName)}`;
  }

  else {
    return `projects/${projectId ?? "Unknown"}/${fileId}-${sanitizeFileName(fileName)}`;
  }
}

/**
 * Converts a readable byte stream into a Base64-encoded string.
 *
 * Primarily used for converting downloaded file streams into a
 * format suitable for previews, downloads, or API transport.
 *
 * @param stream - Readable stream containing binary data.
 * @returns Base64 encoded representation of the stream.
 */
export async function streamToBase64(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  // merge chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  // Node.js way
  return Buffer.from(merged).toString("base64");
}
/**
 * Mapping of application roles to display-friendly labels.
 *
 * Includes a fallback label for undefined role values.
 */
export const RoleLabelRecord: Partial<Record<Role, string>> & { undefined: string } = {
  ADMIN: "Admin",
  SITE_MANAGER: "Site Manager",
  GUEST: "Guest",
  CUSTOMER: "Customer",
  undefined: "No role",
}

/**
 * Narrowing helper: checks whether a value is a plain object (not null, not an array).
 * @param value - unknown value to test
 * @returns boolean indicating if the value is a plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check whether a value is a primitive (string, number, boolean, null or undefined).
 * @param value - value to test
 * @returns boolean indicating primitiveness
 */
export function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}
/**
 * Formats unknown values into display-friendly strings.
 *
 * Handles numbers, booleans, nullish values, and generic objects.
 *
 * @param value - Value to format.
 * @returns Human-readable string representation.
 */
export function formatValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
/**
 * Formats a numeric value as Australian currency.
 *
 * Falls back to {@link formatValue} for non-numeric inputs.
 *
 * @param value - Value to format.
 * @returns Currency-formatted string or fallback representation.
 */
export function formatMoney(value: unknown) {
  if (typeof value !== "number") return formatValue(value);

  return currency.format(value);
}
/**
 * Converts camelCase, snake_case, kebab-case, and similar keys
 * into user-friendly labels.
 *
 * @param key - Object key or identifier.
 * @returns Formatted label.
 *
 * @example
 * toLabel("projectStatus")
 * // "Project Status"
 *
 * toLabel("project_status")
 * // "Project status"
 */
export function toLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}
/**
 * Extracts a numeric count from a known property of an object.
 *
 * Searches the provided keys and returns either:
 * - The length of the first matching array.
 * - The value of the first matching numeric field.
 *
 * @param value - Object to inspect.
 * @param keys - Candidate property names.
 * @returns Extracted count or zero.
 */
export function countEntries(value: unknown, keys: string[]) {
  if (!isPlainObject(value)) return 0;

  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
    if (typeof candidate === "number") {
      return candidate;
    }
  }

  return 0;
}
/**
 * Safely serializes a value to JSON.
 *
 * Falls back to String(value) when serialization fails,
 * such as with circular references.
 *
 * @param v - Value to serialize.
 * @returns JSON string or stringified fallback.
 */
export function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
/**
 * Converts a Base64-encoded PDF string into a Blob.
 *
 * Useful for browser-based PDF previews and downloads.
 *
 * @param base64 - Base64 encoded PDF content.
 * @returns PDF Blob instance.
 */
export const base64ToBlob = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: "application/pdf" });
};
/**
 * Calculates percentage change between two values and returns
 * a dashboard-friendly metric object.
 *
 * When the previous value is zero:
 * - Returns 100% if the current value is greater than zero.
 * - Returns 0% if both values are zero.
 *
 * @param current - Current period value.
 * @param previous - Previous period value.
 * @returns Metric containing the current total and percentage trend.
 *
 * @example
 * calculateTrend(120, 100)
 * // { total: 120, trendDelta: 20 }
 */
export function calculateTrend(
  current: number,
  previous: number
): DataPoint {
  if (previous === 0) {
    return {
      total: current,
      trendDelta: current > 0 ? 100 : 0,
    };
  }

  return {
    total: current,
    trendDelta: Number(
      (((current - previous) / previous) * 100).toFixed(1)
    ),
  };
}

/**
 * Removes quoted email thread history, signatures, and common reply markers from
 * an email body, leaving only the latest message content.
 *
 * Supports common email clients including Gmail, Outlook, Exchange, and mobile
 * email clients by stripping both HTML thread containers and plain-text reply
 * markers.
 *
 * @param text - The raw email body, either plain text or HTML.
 * @returns The cleaned email body containing only the most recent message.
 */
export function stripEmailThread(text: string): string {
  if (!text) return '';

  // 1. Remove HTML-specific thread containers first (if input contains HTML)
  let cleanedText = text
    .replace(/<div class="gmail_quote">[\s\S]*?<\/div>/gi, '')
    .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<span id="OLK_SRC_BODY_SECTION">[\s\S]*?<\/span>/gi, '')
    .replace(/<div id="divRplyFwdMsg"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div style="border-top:\s*solid\s+#[a-f0-9]{3,6}\s+1\.0pt[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div style="border-top:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<hr[^>]*(id="stopSpelling"|tabindex="-1"|style="[^"]*width:\s*98%")[^>]*>[\s\S]*/gi, '')
    .replace(/<div class="gmail_signature"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div class="outlook_signature"[^>]*>[\s\S]*?<\/div>/gi, '');

  // 2. Common text-based markers indicating the start of a thread history or previous replies
  const threadMarkers = [
    /________________________________/i,     // Outlook divider line
    /-----Original Message-----/i,           // Standard desktop email clients
    /\n\s*From:/i,                            // Outlook/Exchange format "From: ..."
    /\n\s*On\s+.+?wrote:/i,                   // Gmail format "On [Date], [User] wrote:"
    /\n\s*On\s+.+?at\s+.+?/i,                 // Alternative iOS/Gmail format
    /Sent from my iPhone/i,                   // Trim default mobile signatures
    /Get Outlook for/i                        // Trim Outlook mobile signatures
  ];

  for (const marker of threadMarkers) {
    const match = cleanedText.match(marker);
    if (match && match.index !== undefined) {
      cleanedText = cleanedText.substring(0, match.index);
    }
  }

  return cleanedText.trim();
}

/**
 * Converts an HTML string into plain text by removing HTML tags, scripts,
 * styles, and decoding the most common HTML entities.
 *
 * This is useful for indexing, searching, or processing email and rich-text
 * content where formatting is not required.
 *
 * @param html - The HTML content to convert into plain text.
 * @returns A whitespace-normalized plain text representation of the HTML.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ') // Remove style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ') // Remove script blocks
    .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, ' ') // Collapse multiple spaces/newlines into one space
    .trim();
}

/**
 * Extracts the visible user-written message from a raw email body.
 *
 * Cleans email content before displaying it in a chat/message interface by
 * removing transport metadata, quoted replies, forwarding blocks, greetings,
 * signature blocks, marketing footers, MIME artifacts, and common email
 * client footers.
 *
 * Handles:
 * - HTML tags and entities.
 * - MIME boundaries and content headers.
 * - Outlook/Gmail reply headers.
 * - Forwarded message blocks.
 * - Previous conversation threads.
 * - Leading greetings ("Hi Name,").
 * - Trailing signature / footer blocks: sign-off words ("Regards",
 *   "Thanks", ...), contact-info blocks (name/email/phone/title/company
 *   with no sign-off word), and marketing-footer furniture (social media
 *   rows, "Unsubscribe", "Privacy Policy", "Accredited By", copyright
 *   lines, standalone "Office"/"Contact" labels). Once the start of the
 *   signature/footer is found, everything from that point to the end of
 *   the email is dropped, even if the individual paragraphs after it don't
 *   themselves look like a signature (e.g. a marketing tagline or an
 *   address block).
 * - Mobile signatures ("Sent from my iPhone", etc.).
 *
 * @param body - Raw email body received from the email provider.
 *
 * @returns A cleaned plain-text email message suitable for UI display.
 *
 * @example
 * ```ts
 * stripEmailBody(`
 * Hi Gurbeer Singh Brar,
 *
 * hi how are you doing
 *
 * Thanks & Regards,
 * Dhrubajyoti Biswas
 * Royal Constructions.
 *
 * Royal Constructions — Building exceptional homes across NSW...
 *
 * Facebook
 * ·
 * Instagram
 *
 * Office
 * ...
 * Accredited By
 * `)
 * // "hi how are you doing"
 * ```
 */
export function stripEmailBody(body: string): string {
  if (!body) return "";
  let cleaned = body;

  // Normalize line endings early so line-anchored regexes behave consistently.
  cleaned = cleaned.replace(/\r\n/g, "\n");

  // Convert common HTML formatting into text. Block-level closing tags
  // become a blank line (paragraph break) rather than a single newline, so
  // downstream paragraph-based signature detection can tell paragraphs
  // apart; <br> stays a single line break within a paragraph.
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n\n");
  // Remove HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");

  // Remove MIME headers/artifacts
  cleaned = cleaned.replace(
    /^(content-type|content-transfer-encoding|mime-version|boundary|message-id):.*$/gim,
    ""
  );
  // Remove MIME separators (e.g. "--boundary123--"). Anchored so it only
  // matches lines that ARE the separator, not marker lines that happen to
  // start with dashes and contain other words (like a forwarded-message
  // marker "---------- Forwarded message ----------").
  cleaned = cleaned.replace(/^--[a-z0-9=_-]+--?\s*$/gim, "");

  // Remove forwarded emails
  cleaned = cleaned.split(/-{2,}\s*forwarded message\s*-{2,}/i)[0];
  // Remove Outlook reply chains
  cleaned = cleaned.split(/\n\s*from:\s.*\n\s*(sent|date):\s/im)[0];
  // Remove Gmail quoted replies
  cleaned = cleaned.split(/\n\s*on\s.+wrote:\s*$/im)[0];
  // Remove common email headers
  cleaned = cleaned.replace(/^(from|to|cc|bcc|sent|date|subject):.*$/gim, "");

  // Remove mobile signatures
  cleaned = cleaned.replace(
    /sent from my (iphone|ipad|android|mobile).*$/gim,
    ""
  );

  // Remove a leading greeting line, e.g. "Hi Khushi Singh," / "Hello John" /
  // plain "Hi," with no name.
  cleaned = cleaned.replace(
    /^\s*(hi|hello|hey|dear)(?:\s+[a-z][a-z .'-]{0,40})?,?\s*\n+/i,
    ""
  );

  cleaned = cleaned.trim();

  // ---------------------------------------------------------------------
  // Footer / signature block removal.
  //
  // Rather than requiring every paragraph from the END of the message to
  // individually "look like" part of a signature (which breaks the moment
  // a footer contains an unrelated-looking paragraph, e.g. "Accredited By"),
  // we scan FORWARD for the first paragraph that looks like the *start* of
  // a signature/footer block, and drop it plus everything after it. Real
  // marketing footers are a grab-bag of paragraph shapes (tagline, social
  // links, office address, unsubscribe line, etc.) that individually don't
  // all "look like" a signature — but once we know where the footer begins,
  // we don't need to classify each one that follows.
  // ---------------------------------------------------------------------

  // Sign-off words. Matched against the FIRST LINE of a paragraph only,
  // requiring nothing but trailing punctuation after the word/phrase, so
  // real sentences that happen to start with "Thanks" ("Thanks for
  // confirming, I'll proceed...") are never mistaken for a signature.
  const SIGNOFF_LINE_RE =
    /^(regards|best regards|kind regards|warm regards|many thanks|thanks(\s*(&|and)\s*regards)?|thank you|cheers|sincerely|best(\s+wishes)?|yours(\s+(truly|sincerely))?)[\s,.!]*$/i;

  const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  const PHONE_RE = /(\+?\d[\d .-]{7,}\d)/;

  const SOCIAL_PLATFORM =
    "(facebook|instagram|linkedin|twitter|youtube|tiktok|pinterest|whatsapp)";
  const SOCIAL_ROW_RE = new RegExp(
    `^${SOCIAL_PLATFORM}(\\s*[·•|,/-]\\s*${SOCIAL_PLATFORM})*$`,
    "i"
  );

  const FOOTER_KEYWORD_RE =
    /^(unsubscribe|privacy policy|terms (of|&) (service|use)|view (this|in) (browser|email)|manage (your\s+)?(subscription|preferences)|update (your\s+)?preferences|accredited by|©|\(c\)\s|all rights reserved)/i;

  const STANDALONE_LABEL_RE =
    /^(office|contact|address|follow us|connect with us)$/i;

  // A paragraph that opens with a sign-off word ("Regards," / "Thanks &
  // Regards," / "Best,") on its own line, followed only by a short name /
  // title / company block.
  const isSignoffParagraph = (p: string): boolean => {
    const lines = p.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0 || lines.length > 5) return false;
    return SIGNOFF_LINE_RE.test(lines[0]);
  };

  // A short block with no sentence-ending punctuation that contains an
  // email address or phone number — i.e. a name/title/company/contact
  // block, even without a preceding sign-off word.
  const isContactBlock = (p: string): boolean => {
    const trimmed = p.trim();
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0 || lines.length > 4) return false;
    const hasContactInfo = EMAIL_RE.test(trimmed) || PHONE_RE.test(trimmed);
    const endsLikeSentence = /[.?!]\s*$/.test(lines[lines.length - 1] || "");
    return hasContactInfo && !endsLikeSentence;
  };

  // Common marketing-footer furniture: unsubscribe/privacy links, social
  // media rows, copyright lines, one-word section labels ("Office",
  // "Contact").
  const isFooterKeywordParagraph = (p: string): boolean => {
    const trimmed = p.trim();
    if (FOOTER_KEYWORD_RE.test(trimmed)) return true;
    if (STANDALONE_LABEL_RE.test(trimmed)) return true;
    if (SOCIAL_ROW_RE.test(trimmed.replace(/\n/g, " ").trim())) return true;
    return false;
  };

  const isSignatureStart = (p: string): boolean =>
    isSignoffParagraph(p) || isContactBlock(p) || isFooterKeywordParagraph(p);

  const paragraphs = cleaned.split(/\n\s*\n/).filter((p) => p.trim() !== "");

  // Find the first paragraph, starting from index 1, that looks like the
  // start of a signature/footer block, then discard it and everything
  // after it. We never cut into paragraph 0: a lone message should never
  // be fully wiped out on a single false-positive match.
  let cutIndex = -1;
  for (let i = 1; i < paragraphs.length; i++) {
    if (isSignatureStart(paragraphs[i])) {
      cutIndex = i;
      break;
    }
  }

  const kept = cutIndex === -1 ? paragraphs : paragraphs.slice(0, cutIndex);
  cleaned = kept.join("\n\n");

  // Normalize whitespace
  cleaned = cleaned
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  return cleaned;
}

/**
 * Normalizes email address strings into a canonical format.
 *
 * Converts email values from different clients/providers into a consistent
 * lowercase email address suitable for comparison, hashing, and storage.
 *
 * Handles:
 * - Outlook mailto wrappers.
 * - Angle bracket formatted emails.
 * - Display name formats.
 * - Duplicate embedded email addresses.
 * - Extra whitespace.
 * - Casing differences.
 *
 * Supported examples:
 * ```
 * "John Doe <john@example.com>"
 * -> "john@example.com"
 *
 * "<John@example.com<mailto:John@example.com>>"
 * -> "john@example.com"
 *
 * "john@example.com<mailto:john@example.com>"
 * -> "john@example.com"
 * ```
 *
 * @param email - Raw email string from an email provider.
 *
 * @returns A normalized lowercase email address, or an empty string
 * if no valid email address is found.
 */
export function normalizeEmailAddress(email: string): string {
  if (!email) return "";

  const normalized = email
    .trim()
    .toLowerCase()

    // Remove mailto:
    .replace(/mailto:/gi, "")

    // Decode common html entities
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")

    // Remove whitespace
    .replace(/\s+/g, "");

  // Extract first valid email occurrence
  const match = normalized.match(
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
  );

  return match?.[0] ?? "";
}