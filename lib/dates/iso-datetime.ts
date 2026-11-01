// A timestamp typed by a person, read strictly.
//
// `new Date(text)` is no validator: it takes "2026-11" and "November 1", reads
// "2026-11-01T09:00" in the server's own time zone, and rolls 30 February
// over into March without a word. Where a typed time decides what a job does,
// it is read here instead: an ISO 8601 date and time with an explicit zone
// ("Z" or "+10:00"), every field in range, the day real for its month.

const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The instant `text` names, or null when it is not a strict ISO datetime. */
export function parseStrictIsoDateTime(text: string): Date | null {
  const match = ISO_DATETIME.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s, zone, zh, zm] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59) return null;
  if (zone !== "Z" && (Number(zh) > 14 || Number(zm) > 59)) return null;
  const parsed = new Date(text.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
