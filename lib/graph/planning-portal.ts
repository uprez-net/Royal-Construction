/**
 * Recognising mail from the NSW Planning Portal and the consent authorities.
 *
 * Every other correspondent on a compliance file is written to before they
 * write to us, so there is a token in the subject and an address on the row to
 * correlate against. The portal is the one that is not: a development
 * application is lodged on a website, and what comes back arrives from whatever
 * address that council's assessment system happens to send under. Across a
 * dozen councils that is a dozen addresses, none of them ours to configure, and
 * several of them changing when a council swaps case management systems.
 *
 * `NSW_PLANNING_PORTAL_EMAIL` was the whole of the previous answer, and it only
 * ever worked for the one address somebody had put in the environment. Mail
 * from a council's own assessment inbox correlated to nothing and fell through
 * to the lead queue, where a request for further information on a live DA sat
 * among sales enquiries.
 *
 * So this is deterministic and layered, and every layer is a string comparison
 * — no model, nothing probabilistic. A message has to satisfy all three:
 *
 *  1. It came from a planning authority's domain.
 *  2. Its subject or body is about a planning matter, in the vocabulary those
 *     systems actually use.
 *  3. It identifies exactly one job on our books, by a reference we recorded
 *     when the application was lodged or by the site address.
 *
 * Any one of these alone is far too loose. A council emails about half a dozen
 * things that are not this job; "development application" appears in mail from
 * the architect; and a site address appears on every thread the file has. The
 * conjunction is what makes it safe, and the third layer is what makes it a
 * correlation rather than a guess — the whole point is to land the message on
 * one project or on none.
 */

/**
 * Domain suffixes a planning authority writes from.
 *
 * Suffixes rather than exact hosts, because a council sends from
 * `@camden.nsw.gov.au`, `@mail.camden.nsw.gov.au` and
 * `@notifications.camden.nsw.gov.au` interchangeably depending on which system
 * generated the message.
 *
 * `nsw.gov.au` covers every NSW council and every state agency, and that
 * breadth is the point rather than an oversight: it is a government-controlled
 * namespace nobody else can send from, so it is a strong signal on its own —
 * and it is still only one of the three layers. A message from Revenue NSW
 * about something unrelated satisfies this and then fails the second and third.
 *
 * Extendable through the environment for the councils that outsource
 * assessment to a private platform and therefore send from a commercial domain.
 * Comma-separated, matched the same way.
 */
const BUILT_IN_AUTHORITY_DOMAINS: readonly string[] = [
  "planningportal.nsw.gov.au",
  "planning.nsw.gov.au",
  "nsw.gov.au",
];

/** Whatever `PLANNING_AUTHORITY_DOMAINS` adds, normalised. */
function configuredAuthorityDomains(): string[] {
  return (process.env.PLANNING_AUTHORITY_DOMAINS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * Whether a sender's domain belongs to a planning authority.
 *
 * Suffix matching is anchored on a dot so `notplanning.nsw.gov.au.example.com`
 * cannot pass by ending with one of ours — the domain must either be the suffix
 * exactly or sit under it.
 */
export function isPlanningAuthorityDomain(
  domain: string | null | undefined,
): boolean {
  if (!domain) return false;
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;

  return [...BUILT_IN_AUTHORITY_DOMAINS, ...configuredAuthorityDomains()].some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/**
 * The vocabulary a planning matter is written in.
 *
 * Taken from what these systems actually send rather than from what a planner
 * would say: "Request for Additional Information", "Notice of Determination",
 * "Your application PAN-123456 has been updated". Deliberately narrow — every
 * phrase here is one that does not appear in ordinary correspondence about a
 * building job, which is what stops the architect's email about the DA
 * satisfying this layer.
 *
 * Matched against the subject and, failing that, the body: a portal
 * notification routinely has a subject as bare as "Case PAN-123456 updated"
 * with everything else in the message.
 */
const PLANNING_PHRASES: readonly RegExp[] = [
  /\bdevelopment application\b/i,
  /\bdevelopment consent\b/i,
  /\bnotice of determination\b/i,
  /\bplanning portal\b/i,
  /\brequest for (?:additional |further )?information\b/i,
  /\badditional information (?:request|required)\b/i,
  /\bconsent authority\b/i,
  /\bdetermination (?:of|for) (?:your )?application\b/i,
  /\bcomplying development certificate\b/i,
  // The portal's own case number, and a council's DA numbering. Both are
  // structural rather than prose, which makes them the most reliable phrases
  // here -- "PAN-1234567" does not occur in anything else.
  /\bPAN-\d{5,9}\b/i,
  /\bDA[-\s/]?\d{2,4}[/-]\d{1,6}\b/i,
];

/** Whether a message is about a planning matter at all. */
export function mentionsPlanningMatter(
  subject: string | null | undefined,
  body?: string | null,
): boolean {
  const haystack = `${subject ?? ""}\n${body ?? ""}`;
  if (!haystack.trim()) return false;
  return PLANNING_PHRASES.some((pattern) => pattern.test(haystack));
}

/**
 * Every application reference quoted in a message, normalised for comparison.
 *
 * The strongest of the three layers, because unlike an address it is a value we
 * recorded ourselves when the application was lodged, and unlike a domain it
 * names one job. A council quoting "DA 2026/0412" against our stored
 * "DA-2026/0412" is the same reference, so both sides are stripped to
 * alphanumerics and upper-cased before they are compared — which is what makes
 * this deterministic rather than a fuzzy match.
 *
 * Short references are dropped. A council that recorded "12" as its application
 * number would otherwise match any message containing a twelve.
 */
export function planningReferencesIn(
  subject: string | null | undefined,
  body?: string | null,
): Set<string> {
  const haystack = `${subject ?? ""}\n${body ?? ""}`;
  const found = new Set<string>();

  for (const pattern of [
    /\bPAN-\d{5,9}\b/gi,
    /\bDA[-\s/]?\d{2,4}[/-]\d{1,6}\b/gi,
    // A bare "2026/0412" beside one of the words above. Councils quote the year
    // and number alone in a subject line more often than not.
    /\b(?:19|20)\d{2}[/-]\d{2,6}\b/g,
  ]) {
    for (const match of haystack.matchAll(pattern)) {
      const normalised = normaliseReference(match[0]);
      if (normalised.length >= 6) {
        found.add(normalised);
      }
    }
  }

  return found;
}

/**
 * A reference stripped to what is actually being compared.
 *
 * Exported because both sides of the comparison have to be put through it: the
 * references found in a message, and the `applicationRef` an admin typed into
 * the lodgement form. Normalising only one side is the bug this prevents.
 */
export function normaliseReference(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Whether a message clears the first two layers.
 *
 * The third — which job it is about — is not answered here, because it needs
 * the database. This is the cheap half, run before any query: a message that
 * fails either of these is not a planning notification, and there is nothing to
 * look up.
 *
 * The configured address stays as a fourth way past the domain check, for a
 * council whose assessment platform sends from a commercial domain nobody has
 * added to `PLANNING_AUTHORITY_DOMAINS` yet. It is an addition to the layers
 * rather than a replacement for them: it still has to be about a planning
 * matter and still has to name one job.
 */
export function looksLikePlanningNotification(params: {
  fromEmail: string;
  domain: string;
  subject: string | null | undefined;
  body?: string | null;
}): boolean {
  const configuredAddress = (process.env.NSW_PLANNING_PORTAL_EMAIL ?? "")
    .trim()
    .toLowerCase();

  const fromAuthority =
    isPlanningAuthorityDomain(params.domain) ||
    (configuredAddress.length > 0 &&
      params.fromEmail.toLowerCase() === configuredAddress);

  if (!fromAuthority) return false;

  return mentionsPlanningMatter(params.subject, params.body);
}

/**
 * Which application a portal message says has been approved, and nothing else.
 *
 * The layer this module was missing. `looksLikePlanningNotification` answers
 * whether a message is a planning matter at all, and that was enough while every
 * such message was something to be read by a person — a request for further
 * information, an acknowledgement, a fee notice. One of them is not: the
 * determination, which says the application has been approved and tells the
 * applicant to log in and download the certificate. Nothing is attached, so the
 * document pipeline sees an email with no files and does nothing, and the file
 * sat reading as "with the portal" for as long as it took somebody to open their
 * inbox and notice.
 *
 * Deterministic, like everything else here, and for the same reason: this decides
 * that a clock stops and a green alert goes up on somebody's project page, and a
 * model that occasionally reads "your application has been refused" as an approval
 * would do real damage. Two conditions, both string comparisons, and both have to
 * hold:
 *
 *  1. The message says a determination has happened **favourably**. Refusals and
 *     requests for information use different words and must not match.
 *  2. The message names which of the three it is about.
 *
 * Returns null on anything it cannot place, which is the common answer and the
 * safe one: an unread determination is a file somebody has to chase, and a
 * misread one is a green tick over an application that was refused.
 */

/**
 * The words a favourable determination is announced in.
 *
 * Taken from what these systems send rather than from what a planner would say.
 * Every phrase has to be one that cannot appear in a refusal or in a request for
 * information, which is the whole difficulty: "determined" alone is useless, since
 * a refusal is a determination too.
 */
const DETERMINATION_PHRASES: readonly RegExp[] = [
  /\bhas been (?:approved|granted|issued)\b/i,
  /\b(?:approved|granted|issued) (?:on|by|with)\b/i,
  /\bdetermination[:\s-]+approved?\b/i,
  /\bapproved with conditions\b/i,
  /\bnotice of determination\b.*\bapprov/i,
  /\bcertificate (?:has been |is )?(?:issued|available|ready)\b/i,
  /\bready (?:for|to) download\b/i,
  /\bdevelopment consent (?:has been )?granted\b/i,
];

/**
 * The words that disqualify a message however approving the rest of it sounds.
 *
 * Checked before the phrases above rather than after, and they win outright. A
 * refusal routinely quotes the application's own description back — "your
 * application for approved works at 14 Example St has been refused" — so a
 * message can satisfy a determination phrase and be the opposite of one.
 *
 * "Request for further information" is here for the same reason: it often arrives
 * carrying the conditions under which approval *would* be granted, which reads
 * like an approval to any phrase list.
 */
const NOT_A_DETERMINATION: readonly RegExp[] = [
  /\b(?:refus|reject|declin|withdraw)/i,
  /\bnot (?:been )?(?:approved|granted|supported)\b/i,
  /\brequest for (?:additional |further )?information\b/i,
  /\badditional information (?:request|required)\b/i,
  /\bunable to (?:approve|determine|issue)\b/i,
  /\bfurther information is (?:required|needed)\b/i,
  /\binvoice\b|\bfee (?:notice|proposal|payable)\b/i,
];

/** What kind of thing a determination message is about. */
export type PortalDeterminationSubject =
  | "COMPLYING_DEVELOPMENT_CERTIFICATE"
  | "CONSTRUCTION_CERTIFICATE"
  | "DEVELOPMENT_APPLICATION";

/**
 * Which of the three a message names, in order of how specific the wording is.
 *
 * The CDC and the construction certificate are tested before the development
 * application, deliberately: a construction certificate notice names the consent
 * it follows ("CC for DA 2026/0412"), so a DA test run first would claim every
 * one of them. The DA is the fallback, which is the right way round — it is the
 * only one of the three whose own vocabulary is also the generic vocabulary of
 * the others.
 */
const SUBJECT_PHRASES: readonly (readonly [
  PortalDeterminationSubject,
  readonly RegExp[],
])[] = [
  [
    "COMPLYING_DEVELOPMENT_CERTIFICATE",
    [/\bcomplying development certificate\b/i, /\bCDC\b/, /\bCDC[-\s]?\d/i],
  ],
  [
    "CONSTRUCTION_CERTIFICATE",
    [
      /\bconstruction certificate\b/i,
      /\bCC[-\s]?\d{2,}/,
      /\bpost[-\s]consent certificate\b/i,
    ],
  ],
  [
    "DEVELOPMENT_APPLICATION",
    [
      /\bdevelopment application\b/i,
      /\bdevelopment consent\b/i,
      /\bnotice of determination\b/i,
      /\bDA[-\s/]?\d{2,4}[/-]\d{1,6}\b/i,
    ],
  ],
];

export function readPortalDetermination(
  subject: string | null | undefined,
  body?: string | null,
): PortalDeterminationSubject | null {
  const haystack = `${subject ?? ""}\n${body ?? ""}`;
  if (!haystack.trim()) return null;

  // The disqualifiers first and absolutely. See NOT_A_DETERMINATION.
  if (NOT_A_DETERMINATION.some((pattern) => pattern.test(haystack))) {
    return null;
  }

  if (!DETERMINATION_PHRASES.some((pattern) => pattern.test(haystack))) {
    return null;
  }

  for (const [kind, patterns] of SUBJECT_PHRASES) {
    if (patterns.some((pattern) => pattern.test(haystack))) {
      return kind;
    }
  }

  // Approving words about a planning matter this cannot name. Null rather than a
  // guess: a determination filed against the wrong application stops the wrong
  // clock and puts a download alert on a certificate nobody applied for.
  return null;
}
