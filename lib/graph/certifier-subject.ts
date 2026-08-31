import { randomBytes } from "node:crypto";

// Pure correlation for certifier mail. Deliberately free of prisma and of the
// Graph client, so it can be unit-tested against captured subject lines —
// the same split lib/graph/offer-reply-classify.ts makes for offer replies.

// The outreach subject carries "[RCCERT-<12 hex>]", and every reply keeps it
// through "Re: …" and "Fw: …" because mail clients quote the subject verbatim.
// That token is what ties an inbound message back to its engagement, and it is
// checked instead of the sender address on purpose: a certifier's office
// answers from whichever address happens to pick the job up.
//
// Case-insensitive on the prefix as well as the hex, which the offer token
// regex is not: subjects come back through mail clients and ticketing systems
// that lower-case them, and the stored refToken is upper-case, so a
// case-sensitive prefix would orphan the whole thread over a cosmetic change.
const CERTIFIER_TOKEN_RE = /\[(RCCERT-[0-9A-F]{12})\]/i;

/**
 * The engagement token quoted in a subject line, or null.
 *
 * Scans rather than anchors, so any number of "Re:"/"Fw:"/"FW: Re:" prefixes —
 * and a certifier who retypes the subject with the token still on it — all
 * resolve. Returned upper-cased so a client that lower-cased the subject still
 * matches the stored refToken.
 */
export function extractCertifierRefToken(
  subject: string | undefined | null,
): string | null {
  if (!subject) {
    return null;
  }
  const match = CERTIFIER_TOKEN_RE.exec(subject);
  return match ? match[1].toUpperCase() : null;
}

/**
 * A fresh engagement token.
 *
 * Six random bytes, matching the RCOFR- tokens minted in lib/data/offer-send.ts.
 * It is not a secret — it appears in a subject line — it only has to be
 * unguessable enough that two live engagements never collide.
 */
export function generateCertifierRefToken(): string {
  return `RCCERT-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/**
 * The subject a certifier thread is opened with.
 *
 * The token goes first so it survives a client that truncates a long subject,
 * and the address follows so a human scanning their inbox can tell one job
 * from another without opening anything.
 */
export function buildCertifierSubject(
  refToken: string,
  subjectAddress: string,
): string {
  return `[${refToken}] ${subjectAddress}`.trim();
}

/**
 * The subject for a reply on an existing thread.
 *
 * Prefixed once: a thread that has been round-tripped a few times already
 * carries "Re:", and stacking another on every send makes the subject unusable
 * long before the engagement is finished.
 */
export function buildCertifierReplySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

// ---------------------------------------------------------------------------
// Address fallback
// ---------------------------------------------------------------------------
//
// The token above is ours, and certifiers do not reliably carry it. Their
// office runs its own job numbering and their mail comes back under it —
// "260449-11 14 Example St, Marrickville" — with our bracketed reference
// retyped away, dropped by a ticketing system, or never quoted because the
// reply was composed fresh rather than hit Reply.
//
// What they do carry, every time, is the site address: it is the only thing
// that identifies the job to them, so it survives every subject they retype.
// Correlating on it reverses the lookup — normalise the address of every live
// engagement and find the one the subject is talking about.
//
// The matching below is deliberately strict about the street number and the
// street type and deliberately relaxed about everything else, because that is
// where the two sides actually differ: a certifier drops the suburb, the state
// and the postcode as often as not, but nobody types the wrong number.

/// "St" -> "Street" and friends. Australia Post's abbreviation set, trimmed to
/// what turns up in residential addresses. Applied to both sides, so it only
/// has to be self-consistent, not complete: an abbreviation missing from here
/// simply has to be spelt the same way twice.
const STREET_TYPE_ALIASES: Record<string, string> = {
  st: "street",
  str: "street",
  rd: "road",
  ave: "avenue",
  av: "avenue",
  cres: "crescent",
  cr: "crescent",
  cct: "circuit",
  cir: "circuit",
  ct: "court",
  crt: "court",
  dr: "drive",
  drv: "drive",
  esp: "esplanade",
  gdns: "gardens",
  hwy: "highway",
  ln: "lane",
  pde: "parade",
  pl: "place",
  sq: "square",
  tce: "terrace",
  bvd: "boulevard",
  blvd: "boulevard",
  wy: "way",
};

/// The token that ends the part of an address worth matching on. Everything
/// before it is the street number and the street name; everything after is
/// suburb, state and postcode, which the certifier is free to omit.
///
/// Every abbreviation above plus the types that have none. Deliberately short
/// of Australia Post's full list, which includes words that are far more often
/// part of a street's name than its type — Fairway Drive, Green Street, Ridge
/// Road. Treating those as the end of the street would cut the core off before
/// the real type and match a different street with the same name. A type
/// missing from here costs a correlation, never a wrong one: the core falls
/// back to the whole address, which the certifier's shortened subject will
/// simply fail to contain, and the message goes to the lead path.
const STREET_TYPES = new Set([
  ...Object.values(STREET_TYPE_ALIASES),
  "alley",
  "arcade",
  "circle",
  "close",
  "concourse",
  "mews",
  "parkway",
  "plaza",
  "promenade",
  "quay",
]);

/// Dropped from both sides. "Unit 3/14" and "3/14" are the same address, and
/// one side writing the marker while the other does not must not lose the
/// match. "Lot" is deliberately absent: on a greenfield site the lot number is
/// the only number there is.
const UNIT_MARKERS = new Set([
  "unit",
  "u",
  "apt",
  "apartment",
  "flat",
  "suite",
  "shop",
  "level",
  "lvl",
  "no",
]);

/// Dropped once the street type has been passed, where they can only be the
/// tail of the address. Guarded on position so a street named after a state
/// and a four-digit street number both survive.
const ADDRESS_TAIL_NOISE = new Set([
  "nsw",
  "vic",
  "qld",
  "sa",
  "wa",
  "tas",
  "nt",
  "act",
  "australia",
  "aus",
]);

/// The certifier's own job number, leading the subject: "260449-11", "26-0449",
/// "J240188". Stripped before anything else so its digits cannot be read as a
/// street number — "260449-11 Smith St" is a job number and a street with no
/// number on it, not number 11.
///
/// Requires either a separator with three-plus digits in front of it or five
/// digits on their own, which no street number reaches. A hyphenated street
/// range ("14-16") is two-digit on the left and so is left alone.
const JOB_REF_RE =
  /^(?:[a-z]{1,4}[-_ ]?)?(?:\d{3,}(?:[-/]\d{1,4})+|\d{5,})\b[\s\-–—:|,.]*/i;

const REPLY_PREFIX_RE = /^(?:re|fwd|fw|aw|tr|vs|sv)\s*(?:\[\d+\])?\s*:\s*/i;

/**
 * The subject with every reply/forward prefix and any leading job number gone.
 *
 * Neither actually breaks the containment test below — they only add tokens in
 * front of the address — but the job number is stripped anyway because its
 * trailing digits sit exactly where a street number would.
 */
export function stripSubjectPrefixes(subject: string): string {
  let out = subject.trim();
  for (;;) {
    const next = out.replace(REPLY_PREFIX_RE, "").trim();
    if (next === out) {
      break;
    }
    out = next;
  }
  return out.replace(JOB_REF_RE, "").trim();
}

/**
 * An address reduced to comparable tokens.
 *
 * Case, punctuation and the "St"/"Street" split all go, so the two sides only
 * have to agree on what the address is, not on how it was typed.
 */
export function addressTokens(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const raw = value
    .toLowerCase()
    .normalize("NFKD")
    // Combining marks, so "Beauté Pde" and "Beaute Pde" are one address.
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    // Apostrophes close up rather than splitting: "St Marys" and "St Mary's".
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!raw) {
    return [];
  }

  const tokens: string[] = [];
  let seenStreetType = false;

  for (const [index, token] of raw.split(" ").entries()) {
    // Never expanded at the front, where "St Marys Rd" is a saint and not a
    // street. An abbreviation only ever means a street type after the name it
    // belongs to.
    const expanded = index > 0 ? (STREET_TYPE_ALIASES[token] ?? token) : token;

    if (UNIT_MARKERS.has(expanded)) {
      continue;
    }
    // The tail carries the state and the postcode, which one side routinely
    // omits. Positional, so "1 Victoria Rd" and "2500 Nowra Rd" are untouched.
    if (
      seenStreetType &&
      (ADDRESS_TAIL_NOISE.has(expanded) || /^\d{4}$/.test(expanded))
    ) {
      continue;
    }
    if (STREET_TYPES.has(expanded)) {
      seenStreetType = true;
    }
    tokens.push(expanded);
  }

  return tokens;
}

/**
 * The part of an address a subject line has to reproduce for a match: the
 * street number through the street type.
 *
 * Empty when the address gives nothing solid to match on — no number, or no
 * name beside it. Correlating a whole engagement on "Sydney" is worse than not
 * correlating it at all, so an address that weak opts out of the fallback and
 * leaves the message to the lead path.
 */
export function siteAddressCore(value: string | undefined | null): string[] {
  const tokens = addressTokens(value);
  const end = tokens.findIndex((token) => STREET_TYPES.has(token));
  const core = end === -1 ? tokens : tokens.slice(0, end + 1);

  if (core.length < 2) {
    return [];
  }
  // A street number and something to call the street. Without both, the core
  // is a suburb name or a stray word and will match far too much.
  const hasNumber = core.some((token) => /\d/.test(token));
  const hasName = core.some((token) => /^[a-z]/.test(token));
  return hasNumber && hasName ? core : [];
}

/**
 * Whether a subject line is talking about this site.
 *
 * Containment rather than equality, and contiguous rather than scattered: the
 * certifier's subject is their job number plus our address, sometimes with the
 * suburb cut and sometimes with a trailing note of their own, so the address
 * sits inside a longer line — but "14 Example Street" must not be satisfied by
 * a subject that happens to mention 14 somewhere and Example Street elsewhere.
 */
export function subjectMentionsSiteAddress(
  subject: string | undefined | null,
  subjectAddress: string | undefined | null,
): boolean {
  const core = siteAddressCore(subjectAddress);
  if (core.length === 0) {
    return false;
  }
  const tokens = addressTokens(stripSubjectPrefixes(subject ?? ""));
  if (tokens.length === 0) {
    return false;
  }
  return ` ${tokens.join(" ")} `.includes(` ${core.join(" ")} `);
}

/// Mailbox providers anyone can sign up to, where the domain says nothing
/// about who is writing. A certifier on one of these has to match on the full
/// address instead — see the sender guard in the notifications route.
const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.com.au",
  "hotmail.com",
  "hotmail.com.au",
  "live.com",
  "live.com.au",
  "msn.com",
  "yahoo.com",
  "yahoo.com.au",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "bigpond.com",
  "bigpond.net.au",
  "optusnet.com.au",
  "iinet.net.au",
  "tpg.com.au",
  "internode.on.net",
  "westnet.com.au",
]);

/**
 * Whether an email domain is a public mailbox provider rather than an office's
 * own.
 */
export function isPublicMailDomain(domain: string | undefined | null): boolean {
  return domain ? PUBLIC_MAIL_DOMAINS.has(domain.trim().toLowerCase()) : false;
}
