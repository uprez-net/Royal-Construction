// The words a caller used for a project → the searches to try, in order.
//
// Project search is a substring match on the project's name and location
// (listProjectsForLookup), and people say an address differently from how it
// was typed: "12 Example Street" for a project saved as "12 Example St, Oran
// Park" found nothing, and Mili told an admin she could not find a project
// she had described a moment earlier (#609). So the voice lookup tries the
// words as said, then with the street type shortened and spelled out, then
// the house number and street name alone, then a lot number on its own.
// Every try goes through the same scoped read; this only chooses the words.
//
// A rewritten search is looser than the words as said ("12 Example" also
// finds "112 Example Rd" and "12 Example Avenue"; "Lot 1234" finds "Lot
// 12345"), so a project it finds counts only if it still has the address the
// caller gave: as whole words, with the street type they said, if they said
// one. Otherwise the next search is tried.

const STREET_TYPES: readonly (readonly [full: string, short: string])[] = [
  ["Street", "St"],
  ["Road", "Rd"],
  ["Avenue", "Ave"],
  ["Drive", "Dr"],
  ["Place", "Pl"],
  ["Court", "Ct"],
  ["Crescent", "Cres"],
  ["Close", "Cl"],
  ["Parade", "Pde"],
  ["Lane", "Ln"],
  ["Boulevard", "Bvd"],
  ["Highway", "Hwy"],
  ["Terrace", "Tce"],
  ["Circuit", "Cct"],
  ["Grove", "Gr"],
  ["Square", "Sq"],
  ["Parkway", "Pkwy"],
];

/** At most this many searches for one question. */
export const PROJECT_SEARCH_MAX_TRIES = 5;

/** A search, and what a project it finds must still match to count. */
export type ProjectSearch = {
  readonly query: string;
  /** Null: the words as said, taken as the search finds them. */
  readonly confirms: ((projectText: string) => boolean) | null;
};

function swapStreetTypes(words: string, to: "short" | "full"): string {
  let out = words;
  for (const [full, short] of STREET_TYPES) {
    const [from, into] = to === "short" ? [full, short] : [short, full];
    out = out.replace(new RegExp(`\\b${from}\\b\\.?`, "gi"), into);
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The project's name or location holds `phrase` as whole words (any spacing),
 * followed by `then` (a pattern) when one is given.
 */
function wholeWords(
  phrase: string,
  then = "",
): (projectText: string) => boolean {
  const body = phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${body}${then}(?=$|[^a-z0-9])`,
    "i",
  );
  return (projectText) => pattern.test(projectText);
}

/** Both spellings of the street type the caller said, as a pattern. */
function streetTypeAfter(word: string): string | null {
  const said = word.replace(/\.$/, "").toLowerCase();
  for (const [full, short] of STREET_TYPES) {
    if (said === full.toLowerCase() || said === short.toLowerCase()) {
      return `\\s+(?:${full}|${short})\\.?`;
    }
  }
  return null;
}

/** "12 Example" out of "lot 1234, 12 Example Street Oran Park". */
function numberAndStreet(words: string): ProjectSearch | null {
  const match = /\b(\d+[a-z]?)\s+([a-z][a-z'’-]+)(?:\s+([a-z]+\.?))?/i.exec(
    words,
  );
  if (!match || /^lot$/i.test(match[2])) return null;
  const query = `${match[1]} ${match[2]}`;
  const type = match[3] ? streetTypeAfter(match[3]) : null;
  return { confirms: wholeWords(query, type ?? ""), query };
}

/** "Lot 1234" out of "lot number 1234", "lot no. 1234" or a bare "1234". */
function lotNumber(words: string): ProjectSearch | null {
  const lot = /\blot\s*(?:number\s*|no\.?\s*|#\s*)?(\d{2,})/i.exec(words);
  const number = lot?.[1] ?? /^\s*(\d{3,})\s*$/.exec(words)?.[1];
  if (!number) return null;
  const query = `Lot ${number}`;
  return { confirms: wholeWords(query), query };
}

/** The searches to try for the caller's words, most literal first. */
export function projectSearchVariants(words: string): ProjectSearch[] {
  const said = words.replace(/\s+/g, " ").trim();
  const rewritten = (query: string): ProjectSearch => ({
    confirms: wholeWords(query),
    query,
  });
  const candidates: (ProjectSearch | null)[] = [
    { confirms: null, query: said },
    rewritten(swapStreetTypes(said, "short")),
    rewritten(swapStreetTypes(said, "full")),
    numberAndStreet(said),
    lotNumber(said),
  ];
  const out: ProjectSearch[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const query = candidate.query.trim();
    if (query.length < 2) continue;
    const same = out.findIndex(
      (search) => search.query.toLowerCase() === query.toLowerCase(),
    );
    if (same < 0) {
      out.push({ ...candidate, query });
    } else if (!out[same].confirms && candidate.confirms) {
      // The same words as a stricter search ("lot 1234" said, "Lot 1234" as a
      // lot number): the stricter check wins, so "Lot 12345" is not it.
      out[same] = { ...out[same], confirms: candidate.confirms };
    }
  }
  return out.slice(0, PROJECT_SEARCH_MAX_TRIES);
}
