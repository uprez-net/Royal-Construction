import { humanizeIsoDatesInText } from "@/lib/dates/sydney";

/**
 * Tool output as the model should read it: every date already a Sydney date.
 *
 * The lead task tools returned `dueAt: task.dueDate.toISOString()`. A task due
 * on a Sydney date is stored at Sydney midnight, which in UTC is the evening
 * before (`2026-09-24T14:00:00.000Z` for Fri 25 Sept), and the model read the
 * date off the string: the lead specialist told the office the Sandhus' site
 * measure was on the 24th, and the orchestrator repeated it (#429). Telling the
 * model to convert did not make it convert. So it is never handed the UTC
 * string: this runs on every specialist tool's result (`toModelOutput`) and on
 * every specialist finding `delegate` returns, and rewrites each ISO date or
 * timestamp — whole values and ones inside prose — the way `lib/dates/sydney`
 * writes them for people ("Fri 25 Sept 2026", or with the time and AEST/AEDT
 * when it is not midnight).
 *
 * Left exact, because a later call needs the value and not a reading of it:
 * - ids, links and URLs, which can contain digits shaped like a date;
 * - file names and email addresses, which are identifiers too
 *   ("2026-09-24.pdf" is a file, not a date);
 * - `updatedAt`, which project requirements quote back as an
 *   optimistic-concurrency token (`expectedUpdatedAt`).
 *
 * A tool whose output the model may edit and write back names those fields
 * with `forModelKeeping`, so a round trip does not store the reading.
 *
 * The workspace still receives the full output; `toModelOutput` changes only
 * what the model reads.
 */

const EXACT_KEY =
  /(?:^id$|Id$|_id$|^ids$|Ids$|href$|Href$|^url$|Url$|updatedAt$|UpdatedAt$|^file$|File$|[Ff]ile[Nn]ame$|^email$|Email$)/;

const NOTHING_KEPT: ReadonlySet<string> = new Set();

export function forPeopleDates(
  value: unknown,
  key = "",
  keep: ReadonlySet<string> = NOTHING_KEPT,
): unknown {
  const exact = EXACT_KEY.test(key) || keep.has(key);
  if (typeof value === "string") {
    return exact ? value : humanizeIsoDatesInText(value);
  }
  if (Array.isArray(value)) {
    return exact ? value : value.map((item) => forPeopleDates(item, key, keep));
  }
  if (value !== null && typeof value === "object") {
    if (exact) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, item]) => [
        name,
        forPeopleDates(item, name, keep),
      ]),
    );
  }
  return value;
}

/** `toModelOutput` for a specialist tool. */
export function forModel(output: unknown): { type: "json"; value: unknown } {
  return { type: "json", value: forPeopleDates(output) };
}

/**
 * `toModelOutput` for a tool whose output includes fields the model may write
 * back as read: those keys, and everything under them, stay exact.
 */
export function forModelKeeping(...keys: readonly string[]) {
  const keep: ReadonlySet<string> = new Set(keys);
  return (output: unknown): { type: "json"; value: unknown } => ({
    type: "json",
    value: forPeopleDates(output, "", keep),
  });
}
