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

function swapStreetTypes(words: string, to: "short" | "full"): string {
  let out = words;
  for (const [full, short] of STREET_TYPES) {
    const [from, into] = to === "short" ? [full, short] : [short, full];
    out = out.replace(new RegExp(`\\b${from}\\b\\.?`, "gi"), into);
  }
  return out;
}

/** "12 Example" out of "lot 1234, 12 Example Street Oran Park". */
function numberAndStreet(words: string): string | null {
  const match = /\b(\d+[a-z]?)\s+([a-z][a-z'’-]+)/i.exec(words);
  if (!match) return null;
  if (/^lot$/i.test(match[2])) return null;
  return `${match[1]} ${match[2]}`;
}

/** "Lot 1234" out of "lot number 1234", "lot no. 1234" or a bare "1234". */
function lotNumber(words: string): string | null {
  const lot = /\blot\s*(?:number\s*|no\.?\s*|#\s*)?(\d{2,})/i.exec(words);
  if (lot) return `Lot ${lot[1]}`;
  const bare = /^\s*(\d{3,})\s*$/.exec(words);
  return bare ? `Lot ${bare[1]}` : null;
}

/** The searches to try for the caller's words, most literal first. */
export function projectSearchVariants(words: string): string[] {
  const said = words.replace(/\s+/g, " ").trim();
  const candidates = [
    said,
    swapStreetTypes(said, "short"),
    swapStreetTypes(said, "full"),
    numberAndStreet(said),
    lotNumber(said),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const text = candidate?.trim();
    if (!text || text.length < 2) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, PROJECT_SEARCH_MAX_TRIES);
}
