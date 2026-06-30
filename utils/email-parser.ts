export interface EmailThread {
  to: string;
  from: string;
  subject: string;
  body: string;
  sentAt: string;
}

/* ========================================================================== *
 * Safety limits — protect against pathological/malicious input.
 * ========================================================================== */
const MAX_INPUT_LENGTH = 2_000_000; // ~2MB; far beyond any real email body
const MAX_RECURSION_DEPTH = 60; // a thread 60 replies deep is already absurd

/**
 * Parses a date string from an email header into a JavaScript Date object.
 *
 * Handles common variations in formatting, including:
 * - Standard date formats
 * - Gmail's "at" suffix
 * - Outlook's timezone display
 * - Weekday prefixes
 *
 * @param value - The date string to parse.
 * @returns A Date object if parsing is successful; otherwise, null.
 */
export function parseEmailDate(value?: string): Date | null {
  if (!value) return null;

  let normalized = value.trim();

  // Remove "at" used by Gmail
  normalized = normalized.replace(/\bat\b/i, "");

  // Remove Outlook timezone display
  normalized = normalized.replace(
    /\s*\(UTC[+-]\d{2}:\d{2}\).*$/i,
    ""
  );

  // First try
  let date = new Date(normalized);

  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  // Try removing weekday
  normalized = normalized.replace(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i,
    ""
  );

  date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

/* ========================================================================== *
 * HTML entity decoding (no DOM dependency required)
 * ========================================================================== */
const NAMED_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&mdash;": "\u2014",
  "&ndash;": "\u2013",
  "&hellip;": "\u2026",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&ldquo;": "\u201c",
  "&rdquo;": "\u201d",
  "&copy;": "\u00a9",
  "&reg;": "\u00ae",
  "&trade;": "\u2122",
};

const NAMED_ENTITY_RE = new RegExp(
  Object.keys(NAMED_ENTITIES)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g"
);

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(NAMED_ENTITY_RE, (m) => NAMED_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeCodePoint(parseInt(h, 16)));
}

/* ========================================================================== *
 * HTML detection
 * ========================================================================== */
function looksLikeHtml(s: string): boolean {
  return /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?>/.test(s);
}

/* ========================================================================== *
 * Balanced tag matching.
 *
 * Plain regex cannot correctly skip over NESTED tags of the same name (e.g.
 * a <blockquote> inside another <blockquote>, which is the normal shape of
 * a multi-reply email thread — every additional reply wraps the previous
 * quote in one more layer). A non-greedy `[\s\S]*?` match stops at the
 * FIRST closing tag it sees, which is usually the innermost one, silently
 * truncating everything from there down. This walks token-by-token and
 * tracks nesting depth so we find the TRUE matching closing tag.
 * ========================================================================== */
interface Range {
  start: number;
  end: number;
}

function findBalancedRange(html: string, openTagStart: number, tagName: string): Range {
  const firstCloseBracket = html.indexOf(">", openTagStart);
  if (firstCloseBracket === -1) return { start: openTagStart, end: html.length };

  const selfClosing = html[firstCloseBracket - 1] === "/";
  if (selfClosing) {
    return { start: openTagStart, end: firstCloseBracket + 1 };
  }

  const tokenRe = new RegExp(`<\\/?${tagName}(?=[\\s>/])[^>]*>`, "gi");
  tokenRe.lastIndex = firstCloseBracket + 1;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html))) {
    if (match[0].startsWith("</")) {
      depth--;
      if (depth === 0) {
        return { start: openTagStart, end: tokenRe.lastIndex };
      }
    } else if (!/\/>\s*$/.test(match[0])) {
      depth++;
    }
  }
  // Malformed/unclosed HTML: fail open (keep the rest of the document)
  // rather than silently dropping content.
  return { start: openTagStart, end: html.length };
}

/* ========================================================================== *
 * Strip an element (and its content) entirely, using balanced matching.
 * Reserved for genuinely disposable content (signature blocks) — quote
 * containers must never be bulk-deleted this way, since that's exactly how
 * the previous implementation silently lost older messages in the thread.
 * ========================================================================== */
function stripElement(html: string, startRe: RegExp, tagName: string): string {
  const m = startRe.exec(html);
  if (!m) return html;
  const range = findBalancedRange(html, m.index, tagName);
  return html.slice(0, range.start) + html.slice(range.end);
}

function stripAllSignatures(html: string): string {
  let out = html;
  let guard = 0;
  while (guard++ < 20) {
    const before = out;
    out = stripElement(out, /<div[^>]*class="[^"]*gmail_signature[^"]*"/i, "div");
    out = stripElement(out, /<div[^>]*class="[^"]*outlook_signature[^"]*"/i, "div");
    if (out === before) break;
  }
  return out;
}

/* ========================================================================== *
 * HTML -> text. Block-aware (not a full renderer), but preserves enough
 * line structure for the header/quote heuristics below to work reliably.
 * ========================================================================== */
function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table)\s*>/gi, "\n");
  s = s.replace(/<(p|div|tr|li|h[1-6])(?:\s[^>]*)?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/* ========================================================================== *
 * HTML peeling: find the EARLIEST quote boundary in a document and split
 * it into { current, rest }.
 *
 * Two kinds of boundary:
 *
 *  - WRAP markers (<blockquote>, Gmail's gmail_quote div, the legacy
 *    Outlook OLK_SRC_BODY_SECTION span, Outlook's border-top divider div):
 *    the older message(s) live INSIDE the element, so we recurse into its
 *    inner HTML to keep peeling further layers.
 *
 *  - FLAT markers (Outlook Web App's divRplyFwdMsg header block, the
 *    Exchange/OWA "stopSpelling" <hr>): these are just a divider — the
 *    older message follows as a SIBLING, not as nested content. For
 *    divRplyFwdMsg specifically, its own text (From/Sent/To/Subject) is
 *    extracted and prefixed onto the remainder so header/subject parsing
 *    still finds it once everything is converted to plain text.
 * ========================================================================== */
interface WrapMarker {
  re: RegExp;
  tag: string;
}

const WRAP_MARKERS: WrapMarker[] = [
  { re: /<blockquote(?=[\s>])/i, tag: "blockquote" },
  { re: /<div[^>]*class="[^"]*gmail_quote[^"]*"/i, tag: "div" },
  { re: /<span[^>]*id="OLK_SRC_BODY_SECTION"/i, tag: "span" },
  { re: /<div[^>]*style="[^"]*border-top:\s*(?:solid|none)[^"]*"[^>]*>/i, tag: "div" },
];

interface WrapMatch {
  index: number;
  tag: string;
}

function findFirstWrapMarker(html: string): WrapMatch | null {
  let best: WrapMatch | null = null;
  for (const marker of WRAP_MARKERS) {
    const m = marker.re.exec(html);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, tag: marker.tag };
    }
  }
  return best;
}

type FlatMatch =
  | { kind: "divRplyFwdMsg"; index: number }
  | { kind: "hr"; index: number; raw: string };

function findFirstFlatMarker(html: string): FlatMatch | null {
  const candidates: FlatMatch[] = [];
  const divReply = /<div[^>]*id="divRplyFwdMsg"/i.exec(html);
  if (divReply) candidates.push({ kind: "divRplyFwdMsg", index: divReply.index });
  const hr = /<hr[^>]*(?:id="stopSpelling"|tabindex="-1"|width:\s*98%)[^>]*>/i.exec(html);
  if (hr) candidates.push({ kind: "hr", index: hr.index, raw: hr[0] });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0];
}

interface PeelResult {
  current: string;
  rest: string;
}

function peelOneHtmlLayer(html: string): PeelResult | null {
  const wrap = findFirstWrapMarker(html);
  const flat = findFirstFlatMarker(html);

  if (!wrap && !flat) return null;

  if (wrap && (!flat || wrap.index <= flat.index)) {
    const range = findBalancedRange(html, wrap.index, wrap.tag);
    const current = html.slice(0, wrap.index);
    const inner = html
      .slice(html.indexOf(">", wrap.index) + 1, range.end)
      .replace(/<\/[a-zA-Z]+>\s*$/, "");
    const after = html.slice(range.end);
    // Inner content is the next (older) message chain. Trailing sibling
    // content (rare: a footer after the quote) is appended rather than
    // discarded, so nothing is silently lost.
    return { current, rest: inner + (after.trim() ? "\n" + after : "") };
  }

  const f = flat as FlatMatch;

  if (f.kind === "hr") {
    const idx = html.indexOf(f.raw, f.index);
    const tagEnd = html.indexOf(">", idx) + 1;
    return { current: html.slice(0, f.index), rest: html.slice(tagEnd) };
  }

  // divRplyFwdMsg: extract its own text as header info, keep scanning.
  const range = findBalancedRange(html, f.index, "div");
  const headerHtml = html.slice(html.indexOf(">", f.index) + 1, range.end);
  const headerText = htmlToText(headerHtml);
  const current = html.slice(0, f.index);

  // An <hr> commonly follows divRplyFwdMsg immediately (OWA's own
  // divider). Consume it here so the recursive call doesn't treat it as a
  // second, redundant flat boundary and incorrectly split header from body.
  let afterStart = range.end;
  const trailingHr = /^\s*<hr[^>]*>/i.exec(html.slice(afterStart));
  if (trailingHr) afterStart += trailingHr[0].length;

  const after = html.slice(afterStart);
  const rest = (headerText ? headerText + "\n\n" : "") + after;
  return { current, rest };
}

/* ========================================================================== *
 * Plain-text line-based splitter.
 *
 * Handles:
 *  - "On <date>, <name> wrote:" (Gmail / Apple Mail / Yahoo), including
 *    variants that wrap across 2–3 lines.
 *  - "-----Original Message-----" / "-----Forwarded Message-----"
 *    (Outlook/Exchange plain text).
 *  - Long underscore rules ("________________________________").
 *  - "From: / Sent|Date: / To: / Subject:" header blocks (Outlook /
 *    Exchange), requiring corroborating fields nearby so a stray "From:"
 *    or "Sent:" inside normal prose does not trigger a false split.
 *  - Classic "> " quoted-line nesting (Thunderbird, mailing lists,
 *    bottom-posted plain text), tracked by depth so each level of
 *    quoting becomes its own thread entry.
 * ========================================================================== */
interface StrippedLine {
  depth: number;
  content: string;
}

function stripQuoteMarker(line: string): StrippedLine {
  const m = /^(\s*>)+\s?/.exec(line);
  if (!m) return { depth: 0, content: line };
  const depth = (m[0].match(/>/g) || []).length;
  return { depth, content: line.slice(m[0].length) };
}

function isOnWroteLine(content: string): boolean {
  return /^On\s.{1,300}\swrote:\s*$/i.test(content.trim());
}

function isSeparatorLine(content: string): boolean {
  const c = content.trim();
  return (
    /^-{2,}\s*Original Message\s*-{2,}$/i.test(c) ||
    /^-{2,}\s*Forwarded Message\s*-{2,}$/i.test(c) ||
    /^_{10,}$/.test(c)
  );
}

/**
 * "On ... wrote:" attribution lines occasionally wrap across 2–3 lines
 * when the sender's name/address is long. Merge them back into one
 * logical line (at the same quote depth) before the main pass so they're
 * recognized as a single boundary instead of leaking into message bodies.
 */
function mergeWrappedOnWroteLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const { depth, content } = stripQuoteMarker(lines[i]);
    if (/^On\s/i.test(content.trim()) && !isOnWroteLine(content)) {
      let combined = content.trim();
      let consumed = 0;
      for (let look = 1; look <= 2 && i + look < lines.length; look++) {
        const next = stripQuoteMarker(lines[i + look]);
        if (next.depth !== depth) break;
        combined += " " + next.content.trim();
        consumed = look;
        if (isOnWroteLine(combined)) break;
      }
      if (isOnWroteLine(combined)) {
        out.push(lines[i].replace(content, combined));
        i += consumed;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out;
}

/**
 * Detects Outlook/Exchange-style "From: / Sent|Date: / Subject:" header
 * blocks. Anchored on a "From:" line, but only confirmed as a real header
 * (rather than a stray word in prose) if a Sent/Date line AND a Subject
 * line both appear within the next few lines at the same quote depth.
 */
function findHeaderBlockStarts(lines: string[]): Set<number> {
  const stripped = lines.map((l) => stripQuoteMarker(l));
  const starts = new Set<number>();
  for (let i = 0; i < stripped.length; i++) {
    if (!/^From:\s*\S/i.test(stripped[i].content.trim())) continue;
    const windowEnd = Math.min(stripped.length, i + 6);
    let hasSentOrDate = false;
    let hasSubject = false;
    for (let j = i + 1; j < windowEnd; j++) {
      if (stripped[j].depth !== stripped[i].depth) continue;
      const c = stripped[j].content.trim();
      if (/^(Sent|Date):\s*\S/i.test(c)) hasSentOrDate = true;
      if (/^Subject:\s*/i.test(c)) hasSubject = true;
    }
    if (hasSentOrDate && hasSubject) starts.add(i);
  }
  return starts;
}

function splitPlainTextThread(text: string): EmailThread[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  let lines = normalized.split("\n");
  lines = mergeWrappedOnWroteLines(lines);
  const headerStarts = findHeaderBlockStarts(lines);

  interface Segment {
    depth: number;
    lines: string[];
  }
  const segments: Segment[] = [];
  let current: Segment = { depth: 0, lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const { depth, content } = stripQuoteMarker(lines[i]);
    const isHeaderStart = headerStarts.has(i);
    const isPureBoundary = isOnWroteLine(content) || isSeparatorLine(content);
    const depthChanged = depth !== current.depth;

    if (isHeaderStart || isPureBoundary || depthChanged) {
      if (current.lines.length) segments.push(current);
      current = { depth, lines: [] };
      if (isPureBoundary && !isHeaderStart) {
        continue; // the boundary marker itself carries no content worth keeping
      }
    }
    current.lines.push(content);
  }
  if (current.lines.length) segments.push(current);

  return segments
    .map((seg): EmailThread => {
      const body = seg.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      const subjectMatch = body.match(/^[ \t]*Subject:[ \t]*(.*)$/im);
      const fromMatch = body.match(/^[ \t]*From:[ \t]*(.*)$/im);
      const toMatch = body.match(/^[ \t]*To:[ \t]*(.*)$/im);
      const sentMatch = body.match(/^[ \t]*(?:Sent|Date):[ \t]*(.*)$/im);

      const subject = subjectMatch?.[1].trim() ?? "";
      const from = fromMatch?.[1].trim() ?? "";
      const to = toMatch?.[1].trim() ?? "";
      const sentAt = sentMatch?.[1].trim() ?? "";

      return {
        from,
        to,
        subject,
        body,
        sentAt,
      };
    })
    .filter(({ body, subject, sentAt, from, to }) =>
      [body, subject, sentAt, from, to].some((value) => value.trim().length > 0)
    ); // discard empty segments (e.g. a "wrote:" line with no content)
}

/* ========================================================================== *
 * Recursive extraction across HTML layers.
 * ========================================================================== */
function extractMessages(content: string, depth: number): EmailThread[] {
  if (depth > MAX_RECURSION_DEPTH) return [];
  if (!content || !content.trim()) return [];

  if (looksLikeHtml(content)) {
    const cleaned = stripAllSignatures(content);
    const peeled = peelOneHtmlLayer(cleaned);

    if (!peeled) {
      return splitPlainTextThread(htmlToText(cleaned));
    }

    const currentText = htmlToText(peeled.current);
    const currentMessages = splitPlainTextThread(currentText);
    const restMessages = extractMessages(peeled.rest, depth + 1);
    return [...currentMessages, ...restMessages];
  }

  return splitPlainTextThread(content);
}

/**
 * Extracts every individual email from a conversation thread.
 *
 * Splits a raw email body (plain text or HTML) into its constituent
 * messages by recognizing the reply/forward conventions used by popular
 * email clients — Gmail, Outlook (desktop, web, and Exchange plain text),
 * and Apple Mail.
 *
 * HTML threads are peeled one quote layer at a time using balanced
 * tag-matching, which correctly handles the deeply nested `<blockquote>`
 * structures that build up over a long reply chain (each new reply wraps
 * the entire previous thread in one more layer). Plain-text threads are
 * parsed line-by-line, tracking both explicit header markers (`On ... 
 * wrote:`, `-----Original Message-----`, `From:/Sent:/Subject:` blocks)
 * and classic `>` quote-depth nesting, so multi-level plain-text threads
 * are fully unwound rather than only split at the first separator found.
 *
 * When a quoted email contains a `Subject:` header (common in Outlook and
 * Exchange messages), it is extracted and returned alongside the
 * corresponding message body. If no subject header is present, the
 * subject is an empty string.
 *
 * The returned array is ordered from newest to oldest, where the first
 * element represents the most recent email. Duplicate entries (identical
 * subject + body, e.g. from a message quoted twice) are removed.
 *
 * @param text - The raw email body as plain text or HTML.
 * @returns An array of parsed email thread entries. Returns an empty array
 * if the input is empty or no message content could be extracted.
 */
export function getAllEmailThreads(text: string): EmailThread[] {
  if (!text?.trim()) return [];
  const input = text.length > MAX_INPUT_LENGTH ? text.slice(0, MAX_INPUT_LENGTH) : text;

  const threads = extractMessages(input, 0);

  const seen = new Set<string>();
  return threads.filter((thread) => {
    const key = `${thread.subject}\0${thread.body}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}