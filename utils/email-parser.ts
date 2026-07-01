/* ============================================================================
 * Email thread parser
 *
 * Handles Gmail (HTML + plain text), Outlook (desktop HTML, OWA HTML,
 * Exchange plain text), and Apple Mail. Zero DOM dependency.
 * ============================================================================ */

export interface EmailThread {
  /** Sender of this message ("Name <email>" or raw address). */
  from: string;
  /** Primary recipient(s) of this message. */
  to: string;
  /** Subject line. Often empty for the newest message (see ThreadContext). */
  subject: string;
  /** Message body with envelope headers stripped. */
  body: string;
  /**
   * Raw send-time string as it appears in the email header. Call
   * `parseEmailDate(thread.sentAt)` to get a `Date` object.
   */
  sentAt: string;
}

/**
 * Caller-supplied envelope metadata for the outermost (newest) message.
 *
 * The first message in a thread is the one the user composed or received as
 * a raw body — it will never contain inline From:/To:/Subject: headers, since
 * those live in the MIME envelope, not the body text. Pass the envelope fields
 * here and they will be applied to `threads[0]` without overwriting any values
 * that were actually parsed from the body.
 */
export interface ThreadContext {
  from?: string;
  to?: string;
  subject?: string;
  sentAt?: string;
}

/* ========================================================================== *
 * Safety limits — protect against pathological / malicious input.
 * ========================================================================== */
const MAX_INPUT_LENGTH = 2_000_000; // ~2 MB; far beyond any real email body
const MAX_RECURSION_DEPTH = 60;     // a thread 60 replies deep is absurd

/* ========================================================================== *
 * HTML entity decoding (no DOM required)
 * ========================================================================== */
const NAMED_ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&mdash;": "\u2014", "&ndash;": "\u2013", "&hellip;": "\u2026",
  "&lsquo;": "\u2018", "&rsquo;": "\u2019",
  "&ldquo;": "\u201c", "&rdquo;": "\u201d",
  "&copy;": "\u00a9", "&reg;": "\u00ae", "&trade;": "\u2122",
};

const NAMED_ENTITY_RE = new RegExp(
  Object.keys(NAMED_ENTITIES)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g"
);

function safeCodePoint(code: number): string {
  try { return String.fromCodePoint(code); } catch { return ""; }
}

function decodeEntities(s: string): string {
  return s
    .replace(NAMED_ENTITY_RE, (m) => NAMED_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeCodePoint(parseInt(h, 16)));
}

/* ========================================================================== *
 * parseEmailDate
 *
 * Normalises the common date-string variants found in email headers and
 * attempts to parse them into a `Date`. Returns `null` on failure.
 * ========================================================================== */

/**
 * Parses a date string from an email header into a JavaScript `Date`.
 *
 * Handles:
 * - Gmail's "at" suffix ("Jan 1, 2024 at 10:00 AM")
 * - Outlook's timezone display ("(UTC+10:00)")
 * - Weekday prefixes ("Monday, January 1, 2024 …")
 *
 * @param value - Raw date string from an email header.
 * @returns A `Date` if parsing succeeds; `null` otherwise.
 */
export function parseEmailDate(value?: string): Date | null {
  if (!value) return null;

  let n = value.trim()
    .replace(/\bat\b/i, "")
    .replace(/\s*\(UTC[+-]\d{2}:\d{2}\).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  let d = new Date(n);
  if (!Number.isNaN(d.getTime())) return d;

  n = n.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i, "");
  d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ========================================================================== *
 * parseOnWroteLine
 *
 * "On Mon, Jan 1, 2024 at 10:00 AM, John Doe <john@example.com> wrote:"
 *
 * This attribution line is produced by Gmail, Apple Mail, and Yahoo. It
 * describes the message that FOLLOWS it (the older quoted message), not the
 * one that contains it. Returns { from, sentAt } for that older message, or
 * null if the line does not match the pattern.
 * ========================================================================== */
interface Attribution {
  from: string;
  sentAt: string;
}

/**
 * Extracts sender and date metadata from a Gmail / Apple Mail attribution line.
 *
 * @param line - A single line of text, e.g. "On Mon, Jan 1, 2024 at 10:00 AM, John Doe <john@example.com> wrote:"
 * @returns `{ from, sentAt }` for the message being attributed, or `null`.
 */
export function parseOnWroteLine(line: string): Attribution | null {
  const trimmed = line.trim();
  if (!/^On\s/i.test(trimmed) || !/\swrote:\s*$/i.test(trimmed)) return null;

  const inner = trimmed
    .replace(/^On\s+/i, "")
    .replace(/\s+wrote:\s*$/i, "")
    .trim();

  // Case A: sender wrapped in angle brackets — most common
  const angleMatch = inner.match(/^([\s\S]*?)\s*(<[^>]+>)\s*$/);
  if (angleMatch) {
    const beforeEmail = angleMatch[1].trim();
    const email = angleMatch[2]; // e.g. <john@example.com>
    const lastComma = beforeEmail.lastIndexOf(",");
    let datePart: string;
    let namePart: string;
    if (lastComma !== -1) {
      datePart = beforeEmail.slice(0, lastComma).trim();
      namePart = beforeEmail.slice(lastComma + 1).trim();
    } else {
      // No comma: heuristic — if it contains a digit it's a date, otherwise a name
      datePart = /\d/.test(beforeEmail) ? beforeEmail : "";
      namePart = /\d/.test(beforeEmail) ? "" : beforeEmail;
    }
    const from = namePart ? `${namePart} ${email}` : email;
    return { from: from.trim(), sentAt: datePart };
  }

  // Case B: no angle brackets — split on last comma
  const lastComma = inner.lastIndexOf(",");
  if (lastComma !== -1) {
    return {
      from: inner.slice(lastComma + 1).trim(),
      sentAt: inner.slice(0, lastComma).trim(),
    };
  }

  // Case C: nothing to split on — store whole string as from
  return { from: inner, sentAt: "" };
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
 * A non-greedy [\s\S]*? regex match stops at the FIRST closing tag it
 * encounters, which in a deeply nested thread (each reply wraps the
 * previous one in another <blockquote>) is almost always the wrong one.
 * This function walks token-by-token and tracks nesting depth to find the
 * TRUE matching closing tag.
 * ========================================================================== */
interface Range {
  start: number;
  end: number;
}

function findBalancedRange(html: string, openTagStart: number, tagName: string): Range {
  const firstClose = html.indexOf(">", openTagStart);
  if (firstClose === -1) return { start: openTagStart, end: html.length };
  if (html[firstClose - 1] === "/") return { start: openTagStart, end: firstClose + 1 };

  const re = new RegExp(`<\\/?${tagName}(?=[\\s>/])[^>]*>`, "gi");
  re.lastIndex = firstClose + 1;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("</")) {
      if (--depth === 0) return { start: openTagStart, end: re.lastIndex };
    } else if (!/\/>\s*$/.test(m[0])) {
      depth++;
    }
  }
  // Malformed / unclosed HTML: fail open rather than silently losing content.
  return { start: openTagStart, end: html.length };
}

/* ========================================================================== *
 * Signature stripping (uses balanced matching — never bulk-deletes content).
 * ========================================================================== */
function stripElement(html: string, startRe: RegExp, tagName: string): string {
  const m = startRe.exec(html);
  if (!m) return html;
  const r = findBalancedRange(html, m.index, tagName);
  return html.slice(0, r.start) + html.slice(r.end);
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
 * HTML → plain text.
 *
 * Block-aware (not a full renderer) but preserves enough line structure for
 * the header-field and attribution-line heuristics below to work reliably.
 * ========================================================================== */
function htmlToText(html: string): string {
  let s = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)\s*>/gi, "\n")
    .replace(/<(p|div|tr|li|h[1-6])(?:\s[^>]*)?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^[ \t]+|[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ========================================================================== *
 * HTML peeling: split a document at its first quote boundary into
 * { current (newest), rest (older chain) }.
 *
 * WRAP markers — older content is INSIDE the element:
 *   <blockquote>, gmail_quote div, OLK_SRC_BODY_SECTION span,
 *   Outlook desktop border-top divider div.
 *   → Recurse into inner HTML.
 *
 * FLAT markers — older content follows as a sibling, not nested content:
 *   OWA's divRplyFwdMsg header block, Exchange/OWA <hr id="stopSpelling">.
 *   → Split at the marker; for divRplyFwdMsg, extract the header text and
 *     prepend it so downstream header-field parsing still finds it.
 * ========================================================================== */
interface WrapMarker { re: RegExp; tag: string; }
const WRAP_MARKERS: WrapMarker[] = [
  { re: /<blockquote(?=[\s>])/i, tag: "blockquote" },
  { re: /<div[^>]*class="[^"]*gmail_quote[^"]*"/i, tag: "div" },
  { re: /<span[^>]*id="OLK_SRC_BODY_SECTION"/i, tag: "span" },
  { re: /<div[^>]*style="[^"]*border-top:\s*(?:solid|none)[^"]*"[^>]*>/i, tag: "div" },
];

interface WrapMatch { index: number; tag: string; }
function findFirstWrapMarker(html: string): WrapMatch | null {
  let best: WrapMatch | null = null;
  for (const marker of WRAP_MARKERS) {
    const m = marker.re.exec(html);
    if (m && (!best || m.index < best.index)) best = { index: m.index, tag: marker.tag };
  }
  return best;
}

type FlatMatch =
  | { kind: "divRplyFwdMsg"; index: number }
  | { kind: "hr"; index: number; raw: string };

function findFirstFlatMarker(html: string): FlatMatch | null {
  const candidates: FlatMatch[] = [];
  const dr = /<div[^>]*id="divRplyFwdMsg"/i.exec(html);
  if (dr) candidates.push({ kind: "divRplyFwdMsg", index: dr.index });
  const hr = /<hr[^>]*(?:id="stopSpelling"|tabindex="-1"|width:\s*98%)[^>]*>/i.exec(html);
  if (hr) candidates.push({ kind: "hr", index: hr.index, raw: hr[0] });
  if (!candidates.length) return null;
  return candidates.sort((a, b) => a.index - b.index)[0];
}

interface PeelResult { current: string; rest: string; }

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
    // Trailing sibling content (rare footer after the quote) is appended
    // rather than discarded, so nothing is silently lost.
    return { current, rest: inner + (after.trim() ? "\n" + after : "") };
  }

  const f = flat as FlatMatch;

  if (f.kind === "hr") {
    const idx = html.indexOf(f.raw, f.index);
    const tagEnd = html.indexOf(">", idx) + 1;
    return { current: html.slice(0, f.index), rest: html.slice(tagEnd) };
  }

  // divRplyFwdMsg: extract its header text and prepend to the rest so that
  // From:/To:/Subject:/Sent: fields are still visible to downstream parsing.
  const range = findBalancedRange(html, f.index, "div");
  const headerText = htmlToText(html.slice(html.indexOf(">", f.index) + 1, range.end));
  const current = html.slice(0, f.index);
  // OWA appends an <hr> immediately after divRplyFwdMsg. Consume it here so
  // the recursive call doesn't treat it as a second flat boundary.
  let afterStart = range.end;
  const trailingHr = /^\s*<hr[^>]*>/i.exec(html.slice(afterStart));
  if (trailingHr) afterStart += trailingHr[0].length;
  return { current, rest: (headerText ? headerText + "\n\n" : "") + html.slice(afterStart) };
}

/* ========================================================================== *
 * Leading header-block extraction.
 *
 * Scans only the first 20 lines (or up to the first blank line after headers
 * are found) for RFC 5322-style field headers: From, To, Cc, Subject,
 * Date/Sent. Blank lines between fields are tolerated because Outlook HTML
 * produces them (each <br>+</p> pair generates an extra newline).
 *
 * Requires From + at least one other field to be "credible" — this prevents
 * stray "From:" in normal prose from triggering a spurious header strip.
 *
 * Residual HTML entities (e.g. &lt; still present after htmlToText) are
 * decoded before the values are stored.
 * ========================================================================== */
const HEADER_FIELD_RE = /^(From|To|Cc|Subject|Date|Sent):\s*(.*)/i;

interface ExtractedHeaders {
  from: string;
  to: string;
  subject: string;
  sentAt: string;
  cleanedBody: string;
}

function extractLeadingHeaders(body: string): ExtractedHeaders {
  const lines = body.split("\n");
  const fields: Record<string, string> = {};
  const headerLineIndices = new Set<number>();
  let consecutiveNonHeaderNonBlank = 0;
  const maxLook = Math.min(lines.length, 20);

  for (let i = 0; i < maxLook; i++) {
    const line = lines[i].trim();
    if (!line) {
      // Blank lines between header fields are normal in Outlook HTML output
      // (<br>+</p> per field). Include them in the header block only if we
      // have already recognised at least one real header field.
      if (Object.keys(fields).length > 0) headerLineIndices.add(i);
      continue;
    }
    const m = line.match(HEADER_FIELD_RE);
    if (m) {
      const key = m[1].toLowerCase().replace("sent", "date"); // Sent → date
      if (!fields[key]) {
        // Decode any residual HTML entities (Outlook leaves &lt;/&gt; in addrs)
        fields[key] = decodeEntities(m[2].trim());
      }
      headerLineIndices.add(i);
      consecutiveNonHeaderNonBlank = 0;
    } else {
      consecutiveNonHeaderNonBlank++;
      // Two consecutive real content lines after at least one header = body
      if (Object.keys(fields).length > 0 && consecutiveNonHeaderNonBlank >= 2) break;
    }
  }

  // A credible header block requires From + at least one other field.
  const credible = !!fields["from"] && Object.keys(fields).length >= 2;
  const cleanedBody = credible
    ? lines
      .filter((_, i) => !headerLineIndices.has(i))
      .join("\n")
      .replace(/^\n+/, "")
      .trim()
    : body;

  return {
    from: fields["from"] ?? "",
    to: fields["to"] ?? "",
    subject: fields["subject"] ?? "",
    sentAt: fields["date"] ?? "",
    cleanedBody,
  };
}

/* ========================================================================== *
 * Plain-text line-based splitter.
 *
 * Handles:
 *  - "On <date>, <name> wrote:" — Gmail, Apple Mail, Yahoo (including
 *    variants that wrap across 2–3 lines when the name/address is long).
 *  - "-----Original Message-----" / "-----Forwarded Message-----"
 *  - Long underscore rules ("________________________________")
 *  - "From:/Sent|Date:/To:/Subject:" header blocks (Outlook/Exchange),
 *    guarded by a multi-field presence check to avoid false splits on
 *    stray "From:" occurrences in prose.
 *  - Classic "> " nesting (Thunderbird, mailing lists), tracked by depth
 *    so each level of quoting becomes its own thread entry.
 *
 * Attribution flow for "On ... wrote:":
 *  The line describes the NEXT (older) message, not the one containing it.
 *  It is parsed into { from, sentAt } and stored as `pendingAttribution`
 *  on the upcoming segment. If that segment turns out to be empty (happens
 *  when the attribution fires immediately before a depth change with no
 *  body lines between them), the attribution is forwarded to the next
 *  non-empty segment rather than silently dropped.
 * ========================================================================== */
interface StrippedLine { depth: number; content: string; }
function stripQuoteMarker(line: string): StrippedLine {
  const m = /^(\s*>)+\s?/.exec(line);
  if (!m) return { depth: 0, content: line };
  return { depth: (m[0].match(/>/g) ?? []).length, content: line.slice(m[0].length) };
}

function isOnWroteLine(content: string): boolean {
  return /^On\s.{1,300}\swrote:\s*$/i.test(content.trim());
}

function isSeparatorLine(content: string): boolean {
  const c = content.trim();
  return (
    /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}$/i.test(c) ||
    /^_{10,}$/.test(c)
  );
}

/** Merge "On … wrote:" lines that wrapped across 2–3 physical lines. */
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
 * Identifies Outlook/Exchange-style "From:/Sent|Date:/Subject:" header blocks
 * by looking for corroborating fields within a short window. A lone "From:"
 * in prose does not qualify.
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

interface Segment {
  depth: number;
  lines: string[];
  pendingAttribution: Attribution | null;
}

function splitPlainTextThread(text: string): EmailThread[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  let lines = normalized.split("\n");
  lines = mergeWrappedOnWroteLines(lines);
  const headerStarts = findHeaderBlockStarts(lines);

  const segments: Segment[] = [];
  let current: Segment = { depth: 0, lines: [], pendingAttribution: null };

  for (let i = 0; i < lines.length; i++) {
    const { depth, content } = stripQuoteMarker(lines[i]);
    const isHeaderStart = headerStarts.has(i);
    const isPureBoundary = isOnWroteLine(content) || isSeparatorLine(content);
    const depthChanged = depth !== current.depth;

    if (isHeaderStart || isPureBoundary || depthChanged) {
      // Parse "On ... wrote:" BEFORE discarding it — the metadata belongs
      // to the upcoming (older) segment, not the one we are about to push.
      let pendingAttribution: Attribution | null = null;
      if (isPureBoundary && isOnWroteLine(content)) {
        pendingAttribution = parseOnWroteLine(content);
      }

      if (current.lines.length) {
        segments.push(current);
      } else if (current.pendingAttribution && !pendingAttribution) {
        // Current segment is empty (attribution fired right before a depth
        // change with no body lines between). Forward the attribution to the
        // next segment rather than losing it.
        pendingAttribution = current.pendingAttribution;
      }

      current = { depth, lines: [], pendingAttribution };
      if (isPureBoundary && !isHeaderStart) continue; // discard marker line
    }
    current.lines.push(content);
  }
  if (current.lines.length) segments.push(current);

  return segments
    .map((seg): EmailThread => {
      const rawBody = seg.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      const extracted = extractLeadingHeaders(rawBody);
      const attr: Partial<Attribution> = seg.pendingAttribution ?? {};
      return {
        from: extracted.from || attr.from || "",
        to: extracted.to || "",
        subject: extracted.subject || "",
        sentAt: extracted.sentAt || attr.sentAt || "",
        body: extracted.cleanedBody,
      };
    })
    .filter((t) => t.body.length > 0 || t.from.length > 0 || t.subject.length > 0);
}

/* ========================================================================== *
 * Recursive HTML extraction.
 *
 * Special case — "attribution-only" current layer:
 *   Gmail's <div class="gmail_attr"> sits INSIDE the gmail_quote container
 *   before the quoted body, so after peeling:
 *     current  → "<div class='gmail_attr'>On ..., John wrote:<br></div>"
 *     rest     → actual quoted body
 *   splitPlainTextThread(currentText) returns [] because the only line is a
 *   pure attribution marker with no body content below it. Without the fix
 *   below, the from/sentAt info is silently discarded and the first message
 *   in restMessages has empty sender/date fields.
 * ========================================================================== */
function extractMessages(content: string, depth: number): EmailThread[] {
  if (depth > MAX_RECURSION_DEPTH || !content?.trim()) return [];

  if (looksLikeHtml(content)) {
    const cleaned = stripAllSignatures(content);
    const peeled = peelOneHtmlLayer(cleaned);
    if (!peeled) return splitPlainTextThread(htmlToText(cleaned));

    const currentText = htmlToText(peeled.current);
    const currentMessages = splitPlainTextThread(currentText);
    const restMessages = extractMessages(peeled.rest, depth + 1);

    // Attribution-only layer fix (see comment above).
    if (currentMessages.length === 0 && restMessages.length > 0) {
      const trimmed = currentText.trim();
      if (trimmed) {
        const attribution = parseOnWroteLine(trimmed);
        if (attribution) {
          const first = restMessages[0];
          if (!first.from && attribution.from) first.from = attribution.from;
          if (!first.sentAt && attribution.sentAt) first.sentAt = attribution.sentAt;
        }
      }
    }

    return [...currentMessages, ...restMessages];
  }

  return splitPlainTextThread(content);
}

/* ========================================================================== *
 * Public API
 * ========================================================================== */

/**
 * Extracts every individual email from a conversation thread.
 *
 * Splits a raw email body (plain text or HTML) into its constituent messages
 * by recognising the reply / forward conventions of:
 *   - **Gmail** — HTML nested `gmail_quote` divs, `gmail_attr` attribution
 *     divs, and plain-text `>` nesting.
 *   - **Outlook desktop** — `border-top` divider divs with inline
 *     `From:/Sent:/To:/Subject:` headers.
 *   - **Outlook Web App (OWA)** — `divRplyFwdMsg` header div + `<hr>`.
 *   - **Exchange plain text** — `-----Original Message-----` separators and
 *     `________________________________` underscore rules.
 *   - **Apple Mail / Yahoo** — `<blockquote type="cite">` and plain-text
 *     `On … wrote:` attribution lines.
 *   - **Thunderbird / mailing lists** — classic `> ` quote-depth nesting.
 *
 * **First-message headers:**
 * The newest message in the thread (returned as `threads[0]`) is the raw
 * body the user wrote or received — its envelope headers (`From`, `To`,
 * `Subject`, `Date`) live in the MIME transport layer, not in the body text,
 * so they can never be extracted. Pass them via the optional `context`
 * parameter and they will be applied to `threads[0]` without overwriting
 * any values that were actually parsed from the body.
 *
 * **Attribution lines:**
 * "On … wrote:" lines are parsed for `from` and `sentAt` and attached to the
 * message they describe (the older, quoted one) rather than discarded.
 *
 * The returned array is ordered **newest → oldest**. Duplicate entries
 * (identical from + to + subject + sentAt + body) are removed.
 *
 * @param text    - Raw email body (plain text or HTML).
 * @param context - Optional envelope metadata for the outermost message.
 * @returns Parsed thread entries, or `[]` if the input is empty.
 */
export function getAllEmailThreads(
  text: string,
  context: ThreadContext = {}
): EmailThread[] {
  if (!text?.trim()) return [];
  const input = text.length > MAX_INPUT_LENGTH ? text.slice(0, MAX_INPUT_LENGTH) : text;

  const threads = extractMessages(input, 0);

  // Apply caller-supplied envelope context to thread[0] — the newest message
  // that never has inline headers of its own. Never overwrite parsed values.
  if (threads.length > 0) {
    const first = threads[0];
    if (!first.from && context.from) first.from = context.from;
    if (!first.to && context.to) first.to = context.to;
    if (!first.subject && context.subject) first.subject = context.subject;
    if (!first.sentAt && context.sentAt) first.sentAt = context.sentAt;
  }

  // Deduplicate on the full identity of each message.
  const seen = new Set<string>();
  return threads.filter((t) => {
    const key = [t.from, t.to, t.subject, t.sentAt, t.body].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}