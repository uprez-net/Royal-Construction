/** Presentation helpers shared by the operations transcript components. */

import { isRecordIdField } from "@/lib/agent/id-fields";
import {
  SYDNEY_TZ,
  formatIsoForPeople,
  formatSydneyDate,
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

/**
 * Turns a tool's validated input into reviewable, labelled fields.
 *
 * A record id field is labelled by what it points at — "Lead", not "Lead Id" —
 * because the approval card shows the record's name in its place; `hideIds`
 * leaves id fields out altogether, for places that cannot name them. A nested
 * set of changes reads as "Stage → Qualified" rather than as JSON (#429), and
 * an id inside it — a reassignment's target — reads as the record's name when
 * `changeLabels` has one, or as the raw id otherwise.
 */
export function toInputFields(
  input: unknown,
  options: InputFieldOptions = {},
): AgentInputField[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        value !== null
        && value !== undefined
        && value !== ""
        && !(options.hideIds && isRecordIdField(key)),
    )
    .map(([key, value]) => ({
      clientFacing: CLIENT_FACING_KEY.test(key),
      key,
      label:
        isRecordIdField(key) && key !== "id"
          ? humanize(key.replace(/Ids?$/, ""))
          : humanize(key),
      prose:
        (PROSE_KEY.test(key) && typeof value === "string")
        || isChangeSetList(value),
      value: isChangeSet(value)
        ? describeChanges(value, options)
        : isChangeSetList(value)
          ? describeChangeList(value, options.itemLabels?.[key], options)
          : formatFieldValue(value),
    }));
}

/**
 * A list of change sets, one per record: a bulk update's `updates` (#616).
 * Shown one line per record so each change can be read before approving all
 * of them, rather than as a block of JSON.
 */
function isChangeSetList(
  value: unknown,
): value is readonly Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(isChangeSet);
}

function describeChangeList(
  items: readonly Record<string, unknown>[],
  names: readonly (string | undefined)[] | undefined,
  options: InputFieldOptions,
): string {
  return items
    .map((item, index) => {
      const name = names?.[index];
      // A named record is named once, at the start of its line; its raw id
      // stays behind it for the tool.
      const changes = describeChanges(item, {
        ...options,
        changeLabels: undefined,
        hideIds: options.hideIds || name !== undefined,
      });
      return name ? `${name}: ${changes}` : `${index + 1}. ${changes}`;
    })
    .join("\n");
}

/** A flat object of field → value, the shape every `changes`/`patch` takes. */
function isChangeSet(value: unknown): value is Record<string, unknown> {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(
      (item) =>
        item === null || typeof item !== "object" || Array.isArray(item),
    )
  );
}

export type InputFieldOptions = {
  readonly hideIds?: boolean;
  /** Names for record ids inside a set of changes, keyed by field name. */
  readonly changeLabels?: Readonly<Record<string, string>>;
  /** For a list of change sets: the record each entry changes, by position. */
  readonly itemLabels?: Readonly<
    Record<string, readonly (string | undefined)[]>
  >;
};

function describeChanges(
  changes: Record<string, unknown>,
  options: InputFieldOptions,
): string {
  return Object.entries(changes)
    .filter(
      ([key, item]) =>
        !(options.hideIds && isRecordIdField(key))
        && !key.startsWith("expected")
        && item !== undefined,
    )
    .map(([key, item]) => {
      const isId = isRecordIdField(key) && key !== "id";
      const label = humanize(isId ? key.replace(/Ids?$/, "") : key);
      const value =
        item === null || item === ""
          ? "(cleared)"
          : ((isId ? options.changeLabels?.[key] : undefined)
            ?? formatFieldValue(item));
      return `${label} → ${value}`;
    })
    .join(" · ");
}

/** `TENDER_SENT` → "Tender sent": a status code is not a word. */
const ENUM_VALUE = /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/;

function formatFieldValue(value: unknown): string {
  if (typeof value === "string" && ENUM_VALUE.test(value.trim()))
    return humanizeEnum(value.trim());
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

/**
 * A result envelope's facts as a person reads them (#432): a status code is a
 * word ("Type · Call", not "Type · CALL"), a flag is Yes or No rather than
 * "false", and a task's `dueAt` and `dueTime` are one "Due" fact instead of two
 * boxes that say the same thing.
 */
export function resultFacts(
  data: Readonly<Record<string, unknown>>,
): { key: string; label: string; value: string }[] {
  const entries = Object.entries(data).filter(
    ([key, value]) =>
      key !== "outreach"
      && !isRecordIdField(key)
      && value !== null
      && value !== undefined
      && value !== ""
      && typeof value !== "object",
  );
  const byKey = new Map(entries);
  const dueTime =
    typeof byKey.get("dueTime") === "string"
      ? (byKey.get("dueTime") as string)
      : null;
  const facts: { key: string; label: string; value: string }[] = [];
  for (const [key, value] of entries) {
    if (key === "dueTime" && byKey.has("dueAt")) continue;
    if (key === "dueAt" && typeof value === "string") {
      // A task's own time is the commitment, so when it has one the card
      // shows the Sydney day of `dueAt` with that time, never `dueAt`'s clock.
      const instant = new Date(value);
      facts.push({
        key,
        label: "Due",
        value:
          dueTime && !Number.isNaN(instant.getTime())
            ? `${formatSydneyDate(instant)}, ${formatClock(dueTime)}`
            : formatDisplayField(key, value),
      });
      continue;
    }
    facts.push({
      key,
      label: humanize(key),
      value:
        typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : typeof value === "string" && isCodeValue(key, value.trim())
            ? humanizeEnum(value.trim())
            : formatDisplayField(key, value),
    });
  }
  return facts;
}

/**
 * A status code, to be read as a word. A one-word code ("CALL") only counts
 * under a field that holds codes, so an acronym elsewhere ("GST") is left as
 * written.
 */
function isCodeValue(key: string, value: string): boolean {
  return (
    ENUM_VALUE.test(value)
    || (/(type|status|stage|kind|state|role|category)$/i.test(key)
      && /^[A-Z][A-Z0-9]+$/.test(value))
  );
}

/** "14:30" → "2:30 pm"; anything else as given. */
function formatClock(value: string): string {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return value;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? "pm" : "am";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${suffix}`;
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
 * Whether a completed tool actually did its job. A tool that answered with an
 * error envelope failed, and so did a `delegate` team whose every task failed;
 * a team where only some failed says which in `note`. A delegate whose
 * specialist returned nothing usable used to show as a green "Completed".
 */
export function toolOutcome(output: unknown): {
  failed: boolean;
  note: string | null;
} {
  if (output === null || typeof output !== "object" || Array.isArray(output))
    return { failed: false, note: null };
  const value = output as {
    kind?: unknown;
    results?: unknown;
    summary?: unknown;
  };
  if (value.kind === "error") return { failed: true, note: null };
  if (!Array.isArray(value.results) || value.results.length === 0)
    return { failed: false, note: null };
  const failedTasks = value.results.filter(
    (result) =>
      result !== null
      && typeof result === "object"
      && (result as { kind?: unknown }).kind === "error",
  ).length;
  return {
    failed: failedTasks === value.results.length,
    note:
      failedTasks > 0 && typeof value.summary === "string"
        ? value.summary
        : null,
  };
}
