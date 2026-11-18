// Framework-agnostic date utilities shared by display components and server
// code. Kept free of React/Next imports so it can be unit-tested with
// `node:test` and reused from server actions, API routes, and client
// components alike.
//
// The single entry point for parsing a free-text date (OCR output, manual
// entry, contract language) is `normalizeDateString`. Display code should
// format through `formatDisplayDate`, which normalizes first and then
// formats with the existing `dateFormat` while forcing `timeZone: "UTC"` so
// a `yyyy-MM-dd` value never drifts a day backwards in a negative-UTC-offset
// timezone.

/**
 * Normalizes a date string to `YYYY-MM-DD`.
 *
 * Supported formats (all case-insensitive on month names):
 * - `2026-06-12`
 * - `12/06/2026`, `12-06-2026`, `12.06.2026`
 * - `12 June 2026`, `12th June 2026`
 * - `June 12, 2026`, `June 12th, 2026`
 * - `12th Day of June 2026`, `12th day of June, 2026`
 * - `the 12th day of June, 2026`
 * - `Signed this 12th day of June 2026`
 * - `Signed this 15 day of June 20 26` (OCR-split year)
 * - `15 June 20 26`
 *
 * Returns `null` when a valid date cannot be extracted.
 *
 * This is the canonical parser: both the extraction form
 * (`components/projects/form/extracted-components.tsx`) and server-side
 * reconciliation (`lib/data/projectReadiness.ts`) import it so there is one
 * definition of "what is a parseable date".
 */
export function normalizeDateString(input: string): string | null {
  if (!input) return null;

  let text = input.trim();

  text = text.replace(/\s+/g, " ");

  text = text.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");

  text = text.replace(/\b(19|20)\s+(\d{2})\b/g, "$1$2");

  text = text.replace(/,/g, "");

  text = text.replace(
    /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\./gi,
    "$1",
  );

  const monthMap: Record<string, number> = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };

  const format = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return date.toISOString().slice(0, 10);
  };

  let m: RegExpMatchArray | null;

  m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return format(+m[1], +m[2], +m[3]);

  m = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (m) return format(+m[3], +m[2], +m[1]);

  m = text.match(/\b([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\b/i);
  if (m) {
    const month = monthMap[m[1].toLowerCase()];
    if (month) return format(+m[3], month, +m[2]);
  }

  m = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/i);
  if (m) {
    const month = monthMap[m[2].toLowerCase()];
    if (month) return format(+m[3], month, +m[1]);
  }

  m = text.match(
    /\b(?:the\s+)?(?:(?:signed|executed|dated)\s+this\s+)?(\d{1,2})\s*(?:day\s+of\s+)?([A-Za-z]+)\s+(\d{4})\b/i,
  );

  if (m) {
    const month = monthMap[m[2].toLowerCase()];
    if (month) return format(+m[3], month, +m[1]);
  }

  const parsed = new Date(text);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * UTC-safe display formatter.
 *
 * Normalizes the input with `normalizeDateString`, then formats the
 * resulting `YYYY-MM-DD` through the existing `dateFormat` while forcing
 * `timeZone: "UTC"`. This removes the `yyyy-MM-dd` timezone drift: a value
 * like `2026-06-12` is interpreted as a UTC midnight instant and formatted
 * consistently regardless of the host timezone, so it never renders as
 * `11 Jun 2026` in a negative-offset zone.
 *
 * Returns the raw string unchanged when the input is non-empty but cannot
 * be parsed — the caller can distinguish "parseable date" from
 * "unverified raw text" by comparing the output to the input, or by calling
 * `normalizeDateString` directly.
 *
 * Returns `null` when the input is empty/nullish so the caller can render a
 * prose placeholder rather than a monospace fact.
 */
export function formatDisplayDate(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  const normalized = normalizeDateString(value);
  if (normalized) {
    const utcDate = new Date(`${normalized}T00:00:00.000Z`);
    return new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(utcDate);
  }

  return value;
}

/**
 * Result of comparing a signed (contract execution) date against a start
 * (on-site commencement) date.
 */
export type SignedStartComparisonResult = {
  readonly state: "ok" | "start_before_signed" | "unparseable";
  readonly normalizedSignedDate: string | null;
  readonly normalizedStartDate: string | null;
};

/**
 * Pure comparison helper that classifies the relationship between a signed
 * date and a start date.
 *
 * - `ok` — both parse and the start date is on or after the signed date,
 *   however long after.
 * - `start_before_signed` — both parse but the start date is before the
 *   signed date (an impossible pair for a real build).
 * - `unparseable` — either date does not parse.
 *
 * There is no upper limit on the gap. A contract is often signed months
 * before the job can start — the HBCF cover, the certificate and the site all
 * have to come first, and the start date follows the HBCF claim date
 * (issue #421). A gap of more than a year used to be refused as a data-entry
 * error, which blocked saving a genuine late start.
 *
 * Both inputs are normalized with `normalizeDateString` before comparison,
 * so OCR formats and `yyyy-MM-dd` are handled identically. The function is
 * pure: it takes explicit dates rather than reading "today" so it is
 * deterministic in tests.
 */
export function compareSignedAndStartDates(
  signedDate: string | null | undefined,
  startDate: string | null | undefined,
): SignedStartComparisonResult {
  const normalizedSignedDate = signedDate
    ? normalizeDateString(signedDate)
    : null;
  const normalizedStartDate = startDate ? normalizeDateString(startDate) : null;

  if (!normalizedSignedDate || !normalizedStartDate) {
    return {
      state: "unparseable",
      normalizedSignedDate,
      normalizedStartDate,
    };
  }

  const signedMs = Date.parse(`${normalizedSignedDate}T00:00:00.000Z`);
  const startMs = Date.parse(`${normalizedStartDate}T00:00:00.000Z`);

  if (Number.isNaN(signedMs) || Number.isNaN(startMs)) {
    return {
      state: "unparseable",
      normalizedSignedDate,
      normalizedStartDate,
    };
  }

  if (startMs < signedMs) {
    return {
      state: "start_before_signed",
      normalizedSignedDate,
      normalizedStartDate,
    };
  }

  return {
    state: "ok",
    normalizedSignedDate,
    normalizedStartDate,
  };
}
