/** Presentation helpers shared by the operations transcript components. */

import {
  SYDNEY_TZ,
  formatIsoForPeople,
  humanizeIsoDatesInText,
  isValidIsoCalendarDate,
} from "@/lib/dates/sydney";

/**
 * Session cost is billed in USD (`maxTokenCostUsdPerSession`), so it is
 * rendered as "USD 0.42" rather than with a bare dollar symbol an Australian
 * office would read as AUD.
 */
const currency = new Intl.NumberFormat("en-AU", {
  currency: "USD",
  currencyDisplay: "symbol",
  style: "currency",
});

const compactNumber = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 1,
  notation: "compact",
});

// Sydney, not the browser's zone: an operator travelling, or a browser set
// to another zone, would otherwise see a different time from the one the
// agent and the rest of the business use.
const clockTime = new Intl.DateTimeFormat("en-AU", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: SYDNEY_TZ,
});

/**
 * Field names whose value reaches someone outside the office. Royal
 * Constructions has no support team to absorb a wrong recipient, subject line
 * or price, so an approval card gives these fields their own emphasis rather
 * than burying them in a grid of arguments.
 */
const CLIENT_FACING_KEY =
  /(email|recipient|to|cc|bcc|subject|body|message|phone|mobile|amount|price|total|cost|rate|gst|due|date|deadline|scheduled|start|end)$/i;

/** Field names whose value is long prose and needs a block, not a cell. */
const PROSE_KEY =
  /(body|message|notes|note|summary|description|reason|instructions|content|html)$/i;

export type AgentInputField = {
  key: string;
  label: string;
  value: string;
  clientFacing: boolean;
  prose: boolean;
};

/** Turns a tool's validated input into reviewable, labelled fields. */
export function toInputFields(input: unknown): AgentInputField[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    )
    .map(([key, value]) => ({
      clientFacing: CLIENT_FACING_KEY.test(key),
      key,
      label: humanize(key),
      prose: PROSE_KEY.test(key) && typeof value === "string",
      value: formatFieldValue(value),
    }));
}

function formatFieldValue(value: unknown): string {
  if (typeof value === "string") return formatDisplayText(stripHtml(value));
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value.map((item) => formatFieldValue(item)).join(", ");
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * A scalar from a tool or result envelope, as a person reads it. Tools and
 * the model pass dates through as ISO strings; the office reads them as
 * "Fri 25 Sept 2026, 9:00 am AEST".
 */
export function formatDisplayValue(value: unknown): string {
  if (typeof value === "string") return formatDisplayText(value);
  return String(value);
}

/**
 * A result field, formatted with its key in mind.
 *
 * Every timestamp is shown in Sydney time, which is right for nearly all of
 * them — and wrong for a field the sender labelled as UTC: a card read "Due At
 * Utc · Fri 2 Oct 2026, 10:00 am AEST". A key ending in "Utc" keeps the
 * instant in UTC and says so.
 */
export function formatDisplayField(key: string, value: unknown): string {
  if (/utc$/i.test(key) && typeof value === "string") {
    const utc = formatUtcInstant(value);
    if (utc) return utc;
  }
  return formatDisplayValue(value);
}

function formatUtcInstant(value: string): string | null {
  const text = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(
      text,
    )
  )
    return null;
  // `new Date` rolls an impossible written date forward ("2026-02-30" becomes
  // 2 March), so the calendar date is checked as written, the same way the
  // Sydney formatter checks it, and anything else falls back unchanged.
  if (!isValidIsoCalendarDate(text.slice(0, 10))) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Free text with any ISO dates in it rewritten in Australian form. */
export function formatDisplayText(value: string): string {
  return formatIsoForPeople(value) ?? humanizeIsoDatesInText(value);
}

/**
 * Assistant markdown with its ISO dates rewritten, leaving code alone: a date
 * inside a code span or block is quoted data, not something to reformat.
 */
export function formatDisplayMarkdown(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((segment, index) =>
      index % 2 === 1 ? segment : humanizeIsoDatesInText(segment),
    )
    .join("");
}

/** Renders the email bodies tools build as HTML back into readable text. */
export function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** `send_compliance_outreach` reads as "Send Compliance Outreach". */
export function humanize(name: string) {
  return name
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

/** `PRIVATE_CERTIFIER` reads as "Private certifier", not as shouting. */
export function humanizeEnum(name: string) {
  return name
    .replaceAll(/[_-]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function formatDuration(
  startedAt: string | null,
  endedAt: string | null,
) {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

export function formatCost(value: number) {
  return value < 0.01 && value > 0 ? "<USD 0.01" : currency.format(value);
}

export function formatTokens(value: number) {
  return value < 1_000 ? String(value) : compactNumber.format(value);
}

export function formatTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : clockTime.format(date);
}

/**
 * A tool that completed but answered with an error envelope did not do its
 * job. The card must read as failed, not as a green "Completed" — a delegate
 * whose specialist returned nothing usable used to look like a success.
 */
export function isErrorOutput(output: unknown): boolean {
  return (
    output !== null
    && typeof output === "object"
    && !Array.isArray(output)
    && (output as { kind?: unknown }).kind === "error"
  );
}
