/** Presentation helpers shared by the operations transcript components. */

const currency = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  currencyDisplay: "narrowSymbol",
  style: "currency",
});

const compactNumber = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 1,
  notation: "compact",
});

const clockTime = new Intl.DateTimeFormat("en-AU", {
  hour: "numeric",
  minute: "2-digit",
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
  if (typeof value === "string") return stripHtml(value);
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
  return value < 0.01 && value > 0 ? "<$0.01" : currency.format(value);
}

export function formatTokens(value: number) {
  return value < 1_000 ? String(value) : compactNumber.format(value);
}

export function formatTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : clockTime.format(date);
}
