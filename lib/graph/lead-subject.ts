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
 * Live-contract administration. A first approach never uses these words.
 *
 * An earlier version of this list used bare nouns ("inspection", "payment",
 * "supplier") and an audit of 800 real messages showed it never fired, so it
 * was deleted outright. Deleting was the wrong correction: the audit shows
 * what arrives at info@ today, not what this vocabulary means. Variations,
 * progress claims, RFIs and purchase orders are the daily language of a live
 * job — this app has a Variations feature — and only the fact that such mail
 * currently goes to a different address keeps it out of this inbox. Route one
 * job's correspondence here and every message opens a fake customer and posts
 * the welcome email to a certifier or a council officer.
 *
 * So the guard is narrow rather than absent: phrases that are unmistakably
 * contract administration, never a single broad noun that a customer might
 * reach for. Add phrases here, not words.
 */
const PROJECT_ADMIN = [
  "variation",
  "progress claim",
  "purchase order",
  "remittance",
  "rfi",
  "request for (?:further )?information",
  "payment request",
  "request for payment",
  "inspection request",
  "request for inspection",
  "supplier quote",
  "estimate revision",
  "revised estimate",
  "practical completion",
  "site instruction",
  "final account",
  "defects? (?:list|liability|notice)",
  "invoice",
].join("|");

/** Vetoes a pattern match, like SOLICITATION. */
const PROJECT_ADMIN_PATTERN = new RegExp(String.raw`\b(?:${PROJECT_ADMIN})\b`);

/**
 * Mail from someone selling to the builder rather than buying from them.
 *
 * This is what the info@ mailbox actually receives: an audit of 800 messages
 * (Jul 2025 - Aug 2026) found trades, recruiters, cleaners, precast suppliers,
 * finance brokers and marketing agencies far outnumber customers, and they
 * write in the customer's vocabulary — "Construction Project Takeoff & Cost
 * Estimate" and "Bid Request For Building Project" both reached the patterns
 * and would have created a lead plus an automated welcome email.
 *
 * Every term here was taken from a real message in that audit. Add to it the
 * same way — from something that actually arrived, not from something that
 * could conceivably arrive.
 */
const SOLICITATION = [
  "takeoff",
  "take off & cost",
  "bid request",
  "labour hire",
  "trade partnership",
  "tender opportunit(?:y|ies)",
  "lead generation",
  "looking for work",
  "available for work",
  "estimator",
  "candidate",
  "cadetship",
  "apprenticeship",
  "traineeship",
  "recruitment",
  "sponsorship",
  "cleaning (?:services|support)",
  "builders cleaning",
  "silicone",
  "precast",
  "clearance stock",
  "price book",
  "construction finance",
  "finance partner",
].join("|");

/**
 * Subjects this system itself sends.
 *
 * They come back to info@ as a cc, a self-copy or inside a bounce, and they
 * are written in the customer's vocabulary because they are addressed to
 * customers — "Your Building Offer — Lot 8358 Expedition Loop, Oran Park"
 * carries a build word and a street address, which is exactly the shape of a
 * genuine enquiry. Left alone it opens a second lead for a customer who
 * already has one.
 *
 * Sourced from the send sites, not invented. When a new template is added
 * there, add its distinctive stem here.
 */
const OWN_OUTBOUND = [
  "your building (?:proposal|offer)",
  "a royal constructions offer for your",
  "welcome to royal constructions",
  // Templates whose opening words a customer could also write are pinned to
  // the rest of the shape we actually send: ours names a location or a date,
  // a customer's does not. "Site visit for my new build" is a customer.
  "next step for your .{0,60}\\bin\\b",
  "following up on your .{0,60}\\bin\\b",
  "royal constructions portfolio for your",
  "finishes catalogue for your",
  "quotation next steps for",
  "fixed price building tender",
  "residential building contract",
  "offer acceptance",
  "variation update for",
  "site visit for .{0,60}\\bon\\b",
  "availability confirmation required",
  "consultation with .{0,60}royal constructions",
  "work reminder",
  "follow-?up (?:reminder|calendar event)",
  "lead note",
].join("|");

/** Vetoes a pattern match, like SOLICITATION. */
const OWN_OUTBOUND_PATTERN = new RegExp(String.raw`\b(?:${OWN_OUTBOUND})\b`);

/** Vetoes a pattern match. Checked after the exact allowlist, never before it. */
const SOLICITATION_PATTERN = new RegExp(String.raw`\b(?:${SOLICITATION})\b`);

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
  new RegExp(String.raw`\b(?:${BUILD_WORK})\b.{0,60}\b(?:${PRICE_ASK})\b`),
  new RegExp(String.raw`\b(?:${PRICE_ASK})\b.{0,60}\b(?:${BUILD_WORK})\b`),

  // "enquiry about building a duplex", "looking to build", "extension request".
  new RegExp(String.raw`\b(?:${BUILD_WORK})\b.{0,60}\b(?:${ENQUIRY})\b`),
  new RegExp(String.raw`\b(?:${ENQUIRY})\b.{0,60}\b(?:${BUILD_WORK})\b`),

  // "I want to build a Granny Flat in Cherrybrook" — a customer stating the
  // intention outright, with no second vocabulary anywhere in the subject. The
  // allowlist holds only the website form's quoted variant, so before this the
  // most explicit enquiry a person can write was the one shape that missed.
  new RegExp(String.raw`\b(?:want|wants|wanting|keen|hoping|planning|looking) to (?:build|renovate)\b`),

  // "New build" — the whole subject is the work and nothing else. Anchored, so
  // it cannot fire on a build word buried in a sentence about something else.
  new RegExp(String.raw`^(?:a |an |the )?(?:${BUILD_WORK})$`),

  // "13 Binalog Road, Pendle Hill - New Build" — a street address is a
  // customer naming their own site. Paired with BUILD_WORK only: pairing it
  // with PRICE_ASK instead pulled in supplier quotes addressed to the builder
  // ("Quote re: 24 Indian Ave Goulburn", "Estimate #870 1 TARPAN PL").
  new RegExp(
    String.raw`\b\d{1,4}[a-z]? [a-z]+(?: [a-z]+)? (?:rd|road|st|street|ave|avenue|cct|circuit|cres|crescent|dr|drive|pde|parade|tce|terrace|pl|place|way|ct|court|ln|lane|loop)\b.{0,60}\b(?:${BUILD_WORK})\b`,
  ),
  new RegExp(
    String.raw`\b(?:${BUILD_WORK})\b.{0,60}\b\d{1,4}[a-z]? [a-z]+(?: [a-z]+)? (?:rd|road|st|street|ave|avenue|cct|circuit|cres|crescent|dr|drive|pde|parade|tce|terrace|pl|place|way|ct|court|ln|lane|loop)\b`,
  ),

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

/**
 * Bounces and vacation autoresponders, which carry the subject of the message
 * that triggered them and so inherit its vocabulary.
 *
 * The audit found five in 800, including "Undeliverable: Welcome to Royal
 * Constructions — Your Home Building Journey Starts Here" — a bounce of this
 * system's own welcome email. None matched, but only by luck: "Undeliverable:
 * Request for Quotation - 145 Oran Park Dr" already carries both "request" and
 * "quotation" and misses solely because no build noun happens to appear.
 */
const AUTO_REPLY_PREFIX =
  /^(?:undeliverable|undelivered mail|automatic reply|auto(?:matic)? response|out of (?:the )?office|delivery (?:has failed|status notification)|mail delivery)\b/;

/**
 * Longest subject the patterns will be run against.
 *
 * The patterns scan an attacker-controlled string synchronously inside the
 * Graph notification handler, and Exchange accepts subject headers far larger
 * than any human writes. A real enquiry subject is a few dozen characters, so
 * refusing to scan past this costs nothing and keeps the handler's time bounded
 * no matter what arrives. The exact allowlist above is unaffected: its entries
 * are all far shorter than the cap.
 */
const MAX_MATCHABLE_SUBJECT = 256;

/** Does this inbound subject identify a website enquiry? */
export function isLeadSubject(subject: string | null | undefined): boolean {
  const normalized = normalizeSubject(subject);
  if (LEAD_SUBJECT_LINES.has(normalized)) return true;
  if (REPLY_PREFIX.test(normalized)) return false;
  if (AUTO_REPLY_PREFIX.test(normalized)) return false;
  if (normalized.length > MAX_MATCHABLE_SUBJECT) return false;
  // Selling outranks the patterns: a vendor writes in the customer's
  // vocabulary, and this mailbox receives more vendors than customers.
  // Administration on a live job outranks the patterns: the two vocabularies
  // are broad enough that a builder's routine mail hits them by coincidence.
  if (PROJECT_ADMIN_PATTERN.test(normalized)) return false;
  if (SOLICITATION_PATTERN.test(normalized)) return false;
  // Our own outbound, arriving back as a cc or self-copy.
  if (OWN_OUTBOUND_PATTERN.test(normalized)) return false;
  return LEAD_SUBJECT_PATTERNS.some((pattern) => pattern.test(normalized));
}
