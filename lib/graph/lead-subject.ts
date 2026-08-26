/**
 * Which inbound email subjects create a lead, and the one definition of how a
 * subject is normalized before matching.
 *
 * These two were separate once: a normalizer stripped quotes while the
 * allowlist still contained `'"i want to build" form submission'` with literal
 * quotes. Every enquiry from that form normalized to something the set did not
 * contain, so it was logged and skipped and no lead row was ever created —
 * silently, since a non-matching subject is the ordinary case for most mail.
 *
 * Keeping the list, the patterns and the normalizer together, with the
 * assertions below, is what stops them drifting apart again.
 *
 * Matching happens in two layers:
 *
 *  1. `LEAD_SUBJECT_LINES` — the exact subjects our own website forms send.
 *     Fixed strings we control, so they are matched whole.
 *  2. `LEAD_SUBJECT_PATTERNS` — subjects a customer types themselves when they
 *     approach the builder about a build ("Custom Build Quote", "quote for a
 *     new home", "enquiry about a granny flat"). These can never be
 *     enumerated, so they are matched by regex against the normalized subject.
 */

/**
 * Lower case, quote-free, single-spaced.
 *
 * Curly quotes count: Outlook and Word autocorrect straight quotes, and the
 * "I want to build" subject is the one that carries them.
 */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D"']/g, "")
    .replace(/\s+/g, " ");
}

/** Subjects that identify a website enquiry, in normalized form. */
export const LEAD_SUBJECT_LINES = new Set([
  "i want to build form submission",
  "get in touch form submission",
  "general enquiry form submission",
  "new message from royal constructions",
]);

// The set has no compiler to check it. Assert at module load that every entry
// is already normalized — an entry that is not can never match anything.
for (const line of LEAD_SUBJECT_LINES) {
  if (normalizeSubject(line) !== line) {
    throw new Error(
      `LEAD_SUBJECT_LINES entry is not normalized and can never match: "${line}"`,
    );
  }
}

// The three vocabularies below are shared by several patterns. They live as
// fragments rather than being repeated inside each literal so that adding a
// word ("duplex", "costing") reaches every pattern that should know about it.

/** The work a customer wants done. */
const BUILD_WORK = [
  "(?:custom |new )?(?:home |house )?build(?:s|ing)?",
  "new (?:home|house)",
  "knock ?down rebuild",
  "rebuild",
  "renovation",
  "renovating",
  "extension",
  "granny flat",
  "duplex",
  "townhouse",
  "house and land",
  "construction project",
].join("|");

/** Asking what it costs. */
const PRICE_ASK = ["quot(?:e|es|ation)", "estimate", "costing", "pricing"].join(
  "|",
);

/** A first approach, rather than a message inside a thread already running. */
const ENQUIRY = [
  "enquir(?:y|ies)",
  "inquir(?:y|ies)",
  "request",
  "interested in",
  "looking (?:to|for)",
  "form submission",
  "contact form",
].join("|");

/**
 * Subjects a customer writes themselves, tested against the normalized
 * subject — so patterns are written lower case, quote-free and single-spaced,
 * and need no `i` flag.
 *
 * The composed ones use `String.raw`: in a plain template literal `\b` is a
 * backspace character, not a word boundary, and the pattern would quietly stop
 * matching while still reading correctly. The load-time check below enforces it.
 */
export const LEAD_SUBJECT_PATTERNS: readonly RegExp[] = [
  // The phrase the quote form and the marketing site both use. Kept as its own
  // literal, ahead of the generic pairs, so it is obvious it is covered.
  /\bcustom[ -]build quote\b/,

  // "quote for a new home", "granny flat estimate", "renovation costing".
  new RegExp(String.raw`\b(?:${BUILD_WORK})\b.*\b(?:${PRICE_ASK})\b`),
  new RegExp(String.raw`\b(?:${PRICE_ASK})\b.*\b(?:${BUILD_WORK})\b`),

  // "enquiry about building a duplex", "looking to build", "extension request".
  new RegExp(String.raw`\b(?:${BUILD_WORK})\b.*\b(?:${ENQUIRY})\b`),
  new RegExp(String.raw`\b(?:${ENQUIRY})\b.*\b(?:${BUILD_WORK})\b`),

  // Generic first-contact subjects the site and the directories send.
  /\b(?:website|web|online) (?:enquiry|inquiry)\b/,
  /\bnew (?:enquiry|inquiry|lead|submission|message|customer) (?:from|via|through)\b/,
];

for (const pattern of LEAD_SUBJECT_PATTERNS) {
  // `g` and `y` carry `lastIndex` between calls, so a shared module-level
  // regex would match every other message — a bug that only shows under load.
  if (pattern.global || pattern.sticky) {
    throw new Error(
      `LEAD_SUBJECT_PATTERNS entry must not use the g or y flag: ${pattern}`,
    );
  }
  // See the note above: a lost String.raw leaves a real backspace behind.
  if (pattern.source.includes("\u0008")) {
    throw new Error(
      "LEAD_SUBJECT_PATTERNS entry contains a literal backspace — a word " +
        `boundary lost to template-literal escaping. Use String.raw: ${pattern}`,
    );
  }
}

/**
 * `re:`, `fw:`, `fwd:` and the equivalents other mail clients prepend.
 *
 * The patterns match anywhere in the subject, so without this a reply inside a
 * live thread ("Re: Custom Build Quote") would read as a brand new enquiry and
 * open a second lead for a customer we already have. The exact allowlist
 * always behaved this way — a prefixed subject never equalled an entry — so
 * this keeps the two layers agreeing.
 */
const REPLY_PREFIX = /^(?:(?:re|fw|fwd|aw|tr|sv|vs)\s*(?:\[\d+\])?\s*:\s*)+/;

/** Does this inbound subject identify a website enquiry? */
export function isLeadSubject(subject: string | null | undefined): boolean {
  const normalized = normalizeSubject(subject);
  if (LEAD_SUBJECT_LINES.has(normalized)) return true;
  if (REPLY_PREFIX.test(normalized)) return false;
  return LEAD_SUBJECT_PATTERNS.some((pattern) => pattern.test(normalized));
}
