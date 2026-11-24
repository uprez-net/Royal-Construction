// The forms people actually say a record by, written beside its text (#621).
//
// An embedding is weak on exactly the words a short question is made of: a
// lot number, a street said "Street" when it was saved "St", a surname, an
// offer reference read out with spaces. "12 Example Street" found nothing for
// a project saved as "12 Example St, Oran Park" (#609), and an offer reference
// typed in a different form found no offer (#618). So each record carries its
// keywords in one normal form, and a question is turned into the same forms;
// the database matches the two arrays exactly (`hasSome`, a GIN index).
//
// Pure and deterministic, like ./text.ts: the same record always gives the
// same keywords, and a test pins them.

/** Street types, written out and as they are abbreviated. */
const STREET_TYPES: readonly (readonly [full: string, short: string])[] = [
  ["street", "st"],
  ["road", "rd"],
  ["avenue", "ave"],
  ["drive", "dr"],
  ["place", "pl"],
  ["court", "ct"],
  ["crescent", "cres"],
  ["close", "cl"],
  ["parade", "pde"],
  ["lane", "ln"],
  ["boulevard", "bvd"],
  ["highway", "hwy"],
  ["terrace", "tce"],
  ["circuit", "cct"],
  ["grove", "gr"],
  ["square", "sq"],
  ["parkway", "pkwy"],
  ["way", "wy"],
];

const STREET_TYPE_FORMS = new Map<string, readonly string[]>();
for (const [full, short] of STREET_TYPES) {
  STREET_TYPE_FORMS.set(full, [full, short]);
  STREET_TYPE_FORMS.set(short, [full, short]);
}

const STATES = new Set(["nsw", "act", "vic", "qld", "sa", "wa", "tas", "nt"]);

/** Words that say nothing about which record is meant. */
const NOISE = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "what",
  "whats",
  "where",
  "when",
  "who",
  "how",
  "job",
  "lead",
  "project",
  "offer",
  "about",
  "please",
  "can",
  "you",
  "our",
  "have",
  "has",
  "are",
  "was",
  "any",
  "all",
  "show",
  "tell",
  "give",
  "find",
  "get",
  "status",
  "update",
  "today",
  "one",
  "mrs",
  "mr",
  "ms",
  "is",
  "at",
  "on",
  "in",
  "of",
  "to",
  "up",
]);

/** Lowercase words and numbers, separated by single spaces. */
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function words(text: string): string[] {
  const normal = normalizeKeyword(text);
  return normal ? normal.split(" ") : [];
}

function add(into: Set<string>, value: string | null | undefined) {
  const normal = value ? normalizeKeyword(value) : "";
  if (normal.length >= 2) into.add(normal);
}

/** A person or business: the whole name and each part worth saying alone. */
export function nameKeywords(name: string | null | undefined): string[] {
  if (!name) return [];
  const out = new Set<string>();
  // "Jordan & Sam Smith" is two people with one surname.
  for (const person of name.split(/\s*(?:&|\band\b|\/|,)\s*/i)) {
    add(out, person);
    for (const part of words(person)) {
      if (part.length >= 2 && !NOISE.has(part) && !/^\d+$/.test(part))
        out.add(part);
    }
  }
  add(out, name);
  return [...out];
}

/**
 * An address: the whole of it, the number and street with the street type in
 * both forms, the street alone, the suburb, and any lot number with and
 * without the word "lot".
 */
export function addressKeywords(location: string | null | undefined): string[] {
  if (!location) return [];
  const out = new Set<string>();
  add(out, location);

  for (const lot of location.matchAll(
    /\blot\s*(?:number\s*|no\.?\s*|#\s*)?(\d{1,6})\b/gi,
  )) {
    out.add(`lot ${lot[1]}`);
    out.add(lot[1]!);
  }

  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const [index, part] of parts.entries()) {
    const tokens = words(part);
    const typeAt = streetTypeAt(tokens);
    if (typeAt > 0) {
      const forms = STREET_TYPE_FORMS.get(tokens[typeAt]!)!;
      const before = tokens.slice(0, typeAt).filter((token) => token !== "lot");
      const numberAt = before.findIndex((token) => /^\d+[a-z]?$/.test(token));
      const street = (numberAt >= 0 ? before.slice(numberAt + 1) : before).join(
        " ",
      );
      const number = numberAt >= 0 ? before[numberAt] : null;
      for (const form of forms) {
        if (street) {
          out.add(`${street} ${form}`);
          if (number) out.add(`${number} ${street} ${form}`);
        }
      }
      if (street) out.add(street);
      if (number && street) out.add(`${number} ${street}`);
      // A suburb said in the same part: "12 Rose St Kellyville".
      const after = tokens
        .slice(typeAt + 1)
        .filter((t) => !isStateOrPostcode(t));
      if (after.length) out.add(after.join(" "));
    } else if (index > 0 || parts.length === 1) {
      // A suburb, with the state and postcode dropped.
      const suburb = tokens.filter((t) => !isStateOrPostcode(t)).join(" ");
      if (suburb && !/^\d+$/.test(suburb) && !/^lot \d+$/.test(suburb))
        out.add(suburb);
    }
  }
  return [...out].filter((keyword) => keyword.length >= 2);
}

/**
 * Where the street type is: the last street-type word with a street name
 * before it. "St" in "12 St Clair Avenue" is Saint, part of the name, and the
 * suffix is "Avenue"; "Grove" in "12 Grove St" is the name. -1 when none.
 */
function streetTypeAt(tokens: readonly string[]): number {
  for (let at = tokens.length - 1; at > 0; at -= 1) {
    if (!STREET_TYPE_FORMS.has(tokens[at]!)) continue;
    const before = tokens.slice(0, at).filter((token) => token !== "lot");
    const numberAt = before.findIndex((token) => /^\d+[a-z]?$/.test(token));
    const name = numberAt >= 0 ? before.slice(numberAt + 1) : before;
    if (name.length > 0) return at;
  }
  return -1;
}

function isStateOrPostcode(token: string): boolean {
  return STATES.has(token) || /^\d{4}$/.test(token);
}

/** The suburb of an address, normalised, or null. For tags. */
export function suburbOf(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1]! : null;
  if (!last) return null;
  const suburb = words(last)
    .filter((t) => !isStateOrPostcode(t))
    .join(" ");
  return suburb && !/\d/.test(suburb) ? suburb : null;
}

/**
 * An offer reference in every form it is typed or said: "RC-2026-014",
 * "RC 2026 014", "rc2026014", and each with its revision ("R2").
 */
export function referenceKeywords(
  reference: string | null | undefined,
  revisionNumber?: number,
): string[] {
  if (!reference?.trim()) return [];
  const spaced = normalizeKeyword(reference);
  const compact = spaced.replaceAll(" ", "");
  const out = new Set<string>([spaced, compact]);
  if (revisionNumber !== undefined) {
    out.add(`${spaced} r${revisionNumber}`);
    out.add(`${compact}r${revisionNumber}`);
  }
  return [...out].filter((keyword) => keyword.length >= 2);
}

/** Lowercase tag text: `stage:quoted`, `suburb:oran park`. */
export function tag(name: string, value?: string | null): string | null {
  if (value === undefined) return name;
  if (value === null || value.trim() === "") return null;
  return `${name}:${normalizeKeyword(value)}`;
}

export function uniqueSorted(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}

const MAX_QUERY_KEYS = 60;

/**
 * A question turned into the forms keywords are stored in: every run of one
 * to four words, each run with its street type swapped for the other form,
 * and each run that holds a number also without its spaces ("rc 2026 014" →
 * "rc2026014"). Single words that say nothing ("the", "job") are left out.
 */
export function queryKeywords(query: string): string[] {
  const tokens = words(query);
  const out = new Set<string>();
  for (let size = 1; size <= 4; size += 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const run = tokens.slice(start, start + size);
      if (size === 1 && (NOISE.has(run[0]!) || run[0]!.length < 2)) continue;
      if (run.every((token) => NOISE.has(token))) continue;
      const phrase = run.join(" ");
      out.add(phrase);
      const last = run[run.length - 1]!;
      const forms = STREET_TYPE_FORMS.get(last);
      if (forms) {
        for (const form of forms)
          out.add([...run.slice(0, -1), form].join(" "));
      }
      if (size > 1 && run.some((token) => /\d/.test(token)))
        out.add(run.join(""));
    }
  }
  return [...out].slice(0, MAX_QUERY_KEYS);
}

/**
 * How much the matched keywords say about this record: a longer matched run
 * is stronger evidence than one word, and a number in it (a lot, a house
 * number, a reference) stronger still.
 */
export function keywordScore(
  queryKeys: readonly string[],
  recordKeywords: readonly string[],
): number {
  if (!queryKeys.length || !recordKeywords.length) return 0;
  const stored = new Set(recordKeywords);
  let score = 0;
  for (const key of queryKeys) {
    if (!stored.has(key)) continue;
    const size = key.split(" ").length;
    score += Math.min(0.3, 0.12 * size) + (/\d/.test(key) ? 0.1 : 0);
  }
  return Math.min(0.9, score);
}
