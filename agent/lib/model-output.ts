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
 * - `updatedAt`, which project requirements quote back as an
 *   optimistic-concurrency token (`expectedUpdatedAt`).
 *
 * The workspace still receives the full output; `toModelOutput` changes only
 * what the model reads.
 */

const EXACT_KEY =
  /(?:^id$|Id$|_id$|^ids$|Ids$|href$|Href$|^url$|Url$|updatedAt$|UpdatedAt$)/;

export function forPeopleDates(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return EXACT_KEY.test(key) ? value : humanizeIsoDatesInText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => forPeopleDates(item, key));
  }
  if (value !== null && typeof value === "object") {
    if (EXACT_KEY.test(key)) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, item]) => [
        name,
        forPeopleDates(item, name),
      ]),
    );
  }
  return value;
}

/** `toModelOutput` for a specialist tool. */
export function forModel(output: unknown): { type: "json"; value: unknown } {
  return { type: "json", value: forPeopleDates(output) };
}
