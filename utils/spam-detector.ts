import { franc } from "franc";

/* ========================================================================== *
 * Configuration
 * ========================================================================== */

/**
 * Minimum score required before an email is considered worth sending to the AI.
 *
 * Increasing this threshold reduces token usage but may reject legitimate
 * customer enquiries.
 *
 * Lowering it increases recall while allowing more newsletters and marketing
 * emails through.
 *
 * A score of 2 has proven to be a good balance for construction-related inboxes.
 */
export const MINIMUM_EVALUATION_SCORE = 2;

/**
 * Minimum amount of text required before language detection is considered
 * reliable.
 *
 * Language detectors perform poorly on very short emails such as:
 *
 *  - "Thanks."
 *  - "Yes."
 *  - "Call me tomorrow."
 *
 * Those should never be penalized simply because the detector guessed the
 * wrong language.
 */
export const MIN_LANGUAGE_LENGTH = 80;

/**
 * Weights applied to every scoring signal.
 *
 * Centralizing these makes the pipeline easy to tune without hunting through
 * the evaluation logic, and guarantees that two runs against the same input
 * with the same config always produce the same score (no hidden constants).
 */
export const SCORE_WEIGHTS = {
  keywordPerMatch: 1,
  keywordMaxContribution: 3,
  emailAddressPresent: 1,
  phoneNumberPresent: 1,
  reasonableLength: 1,
  englishLanguage: 1,
  foreignLanguage: -4,
  nonLatinScript: -3,
  spamPatternPerMatch: -2,
  excessiveHyperlinks: -2,
  repetitiveContent: -2,
  excessiveCapitalization: -2,
  excessivePunctuation: -1,
  suspiciousSenderDomain: -3,
  subjectAllCaps: -1,
  singleWordKeywordBonusCap: 3,
} as const;

/**
 * Construction-related keywords that frequently appear in genuine customer
 * enquiries.
 *
 * These are intentionally broad. The goal is not perfect classification but
 * rather identifying emails that are likely to describe construction work.
 *
 * Multi-word phrases are matched literally; single words are matched on word
 * boundaries so substrings inside unrelated words (e.g. "job" inside
 * "jobless" placeholder text, or "site" inside "opposite") don't silently
 * inflate the score.
 */
const CONSTRUCTION_KEYWORDS = [
  "quote",
  "quotation",
  "estimate",
  "project",
  "builder",
  "building",
  "construction",
  "contractor",
  "roof",
  "roofing",
  "plumber",
  "plumbing",
  "electrician",
  "electrical",
  "painting",
  "painter",
  "tiling",
  "tiler",
  "concrete",
  "driveway",
  "garage",
  "deck",
  "fence",
  "carpentry",
  "carpenter",
  "repair",
  "maintenance",
  "renovation",
  "extension",
  "demolition",
  "property",
  "site",
  "job",
  "inspection",
  "install",
  "installation",
  "replace",
  "replacement",
  "leak",
  "water damage",
  "invoice",
] as const;

/**
 * Pre-compiled word-boundary regexes for each keyword, built once at module
 * load time rather than per-call, keeping evaluation cheap and deterministic
 * (no regex construction order/caching differences between calls).
 */
const CONSTRUCTION_KEYWORD_PATTERNS: RegExp[] = CONSTRUCTION_KEYWORDS.map(
  (keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Multi-word phrases use plain substring-safe boundaries; single words
    // get strict \b boundaries to avoid matching inside longer words.
    return keyword.includes(" ")
      ? new RegExp(escaped, "i")
      : new RegExp(`\\b${escaped}\\b`, "i");
  },
);

/**
 * Common spam indicators, grouped by category with independent severity.
 *
 * Categories let us reason about *why* something scored low, and allow
 * per-category caps so one class of pattern (e.g. URLs) doesn't dominate the
 * score purely by repetition within the same category.
 */
const SPAM_PATTERN_GROUPS: Array<{
  name: string;
  patterns: RegExp[];
  maxMatches: number; // cap contributions from this group
}> = [
  {
    name: "bbcode/markup injection",
    patterns: [/\[url=.*?\]/i, /\[\/url\]/i, /\[b\]/i, /\[i\]/i],
    maxMatches: 2,
  },
  {
    name: "financial scam",
    patterns: [
      /\bcasino\b/i,
      /\bgambling\b/i,
      /\bcrypto(?:currency)?\b/i,
      /\bbitcoin\b/i,
      /\bforex\b/i,
      /\bloan\b/i,
      /\bpayday\b/i,
      /\bearn \$?\d+/i,
      /\bfree money\b/i,
      /\bwire transfer\b/i,
      /\binheritance\b/i,
    ],
    maxMatches: 3,
  },
  {
    name: "pharma spam",
    patterns: [/\bviagra\b/i, /\bcialis\b/i, /\bweight loss\b/i],
    maxMatches: 2,
  },
  {
    name: "marketing bait",
    patterns: [
      /\bwork from home\b/i,
      /\bclick here\b/i,
      /\blimited time\b/i,
      /\bact now\b/i,
      /\bunsubscribe\b/i,
      /\bspecial offer\b/i,
      /\bcongratulations,? you\b/i,
      /\byou('ve| have) been selected\b/i,
    ],
    maxMatches: 3,
  },
];

/* ========================================================================== *
 * Types
 * ========================================================================== */

/**
 * A single scoring contribution, used for deterministic, auditable
 * explanations instead of free-form strings only.
 */
export interface ScoreSignal {
  /** Machine-readable identifier, stable across versions. */
  code: string;
  /** Points contributed (positive or negative). */
  delta: number;
  /** Human-readable explanation. */
  reason: string;
}

/**
 * Optional email headers used for additional deterministic signals.
 * All fields are optional so the pipeline degrades gracefully when header
 * data isn't available (e.g. plain-text-only ingestion).
 */
export interface EmailHeaders {
  from?: string;
  replyTo?: string;
  listUnsubscribe?: string;
}

/**
 * Result returned by the evaluation pipeline.
 */
export interface EmailEvaluationResult {
  /**
   * Final score after all positive and negative signals have been applied.
   */
  score: number;

  /**
   * Whether this email should be sent to the LLM.
   */
  shouldEvaluate: boolean;

  /**
   * Ordered, structured list of every signal that contributed to the score.
   * Ordering is fixed (see EVALUATION_STAGES) so output is byte-identical
   * across runs given identical input.
   */
  signals: ScoreSignal[];

  /**
   * Human-readable explanation of how the score was produced.
   *
   * Derived from `signals`; kept for backwards compatibility with callers
   * that only want strings.
   */
  reasons: string[];

  /**
   * ISO 639-3 language code returned by franc.
   *
   * Examples:
   *
   * eng
   * deu
   * fra
   * slv
   * und (undetermined)
   */
  language?: string;
}

/* ========================================================================== *
 * Helpers
 * ========================================================================== */

/**
 * Returns true if the supplied text contains characters outside the Latin
 * Unicode script.
 *
 * This catches emails written in scripts such as:
 *
 *  - Arabic
 *  - Cyrillic
 *  - Chinese
 *  - Japanese
 *  - Korean
 *  - Hindi
 *
 * Latin-based languages (English, German, French, Slovenian, etc.) will
 * correctly return false.
 */
export function isNonLatinScript(text: string): boolean {
  const letters = text.match(/\p{L}/gu);

  if (!letters) return false;

  return letters.some((char) => !/\p{Script=Latin}/u.test(char));
}

/**
 * Counts how many distinct construction-related keywords appear in the
 * email, using word-boundary matching for single words.
 *
 * Returns the count of *distinct* keywords matched, not total occurrences,
 * so a single word repeated many times cannot inflate the score — that's
 * handled separately by the repetition check.
 */
function countConstructionKeywords(text: string): {
  count: number;
  matched: string[];
} {
  const matched: string[] = [];

  CONSTRUCTION_KEYWORD_PATTERNS.forEach((pattern, index) => {
    if (pattern.test(text)) {
      matched.push(CONSTRUCTION_KEYWORDS[index]);
    }
  });

  return { count: matched.length, matched };
}

/**
 * Counts spam pattern matches per group, capped independently so a single
 * category can't dominate the score.
 */
function evaluateSpamPatternGroups(
  text: string,
): { totalCapped: number; details: Array<{ name: string; matches: number; capped: number }> } {
  const details = SPAM_PATTERN_GROUPS.map((group) => {
    const matches = group.patterns.filter((p) => p.test(text)).length;
    const capped = Math.min(matches, group.maxMatches);
    return { name: group.name, matches, capped };
  });

  const totalCapped = details.reduce((sum, d) => sum + d.capped, 0);

  return { totalCapped, details };
}

/**
 * Detects the language using franc.
 *
 * Language detection is skipped for very short emails because the result is
 * unreliable.
 */
function detectLanguage(text: string): string | undefined {
  if (text.length < MIN_LANGUAGE_LENGTH) {
    return undefined;
  }

  return franc(text);
}

/**
 * Extracts the domain portion of a `From` header value, if present.
 * Handles both `Name <user@domain.com>` and bare `user@domain.com` formats.
 */
function extractSenderDomain(from: string | undefined): string | undefined {
  if (!from) return undefined;

  const match = from.match(/@([A-Z0-9.-]+\.[A-Z]{2,})/i);

  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Flags common free-mailer-plus-mismatch patterns and lookalike domains that
 * are frequently used in spoofed sender addresses. This is intentionally
 * conservative — it flags obvious homoglyph/typosquat patterns, not merely
 * "is a free provider" (since legitimate customers use Gmail too).
 */
function isSuspiciousSenderDomain(
  from: string | undefined,
  replyTo: string | undefined,
): boolean {
  const fromDomain = extractSenderDomain(from);
  const replyToDomain = extractSenderDomain(replyTo);

  if (!fromDomain || !replyToDomain) return false;

  // Reply-To silently pointing to a different domain than From is a classic
  // phishing/spam pattern in enquiry-style emails.
  return fromDomain !== replyToDomain;
}

/**
 * Computes the ratio of uppercase letters to total letters, ignoring
 * non-letter characters. Used to detect shouty spam ("FREE MONEY NOW").
 */
function uppercaseRatio(text: string): number {
  const letters = text.match(/[a-zA-Z]/g);
  if (!letters || letters.length < 20) return 0; // too short to be meaningful

  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase());
  return upper.length / letters.length;
}

/**
 * Computes the ratio of exclamation/question marks to total sentence-ending
 * punctuation-bearing characters, capturing "!!!" / "???" spam styling.
 */
function excessivePunctuationCount(text: string): number {
  const bangs = text.match(/!{2,}/g)?.length ?? 0;
  const questionSpam = text.match(/\?{2,}/g)?.length ?? 0;
  return bangs + questionSpam;
}

/* ========================================================================== *
 * Main Evaluation
 * ========================================================================== */

/**
 * Performs a lightweight heuristic evaluation to determine whether an email is
 * worth sending to the AI for lead extraction.
 *
 * This function exists solely to reduce unnecessary LLM usage.
 *
 * The pipeline is fully deterministic: given the same subject, body, and
 * headers, it always produces the same score and the same ordered signal
 * list. All thresholds live in named constants (SCORE_WEIGHTS,
 * MIN_LANGUAGE_LENGTH, MINIMUM_EVALUATION_SCORE) — there are no inline magic
 * numbers, and no reliance on iteration order of unordered structures (Sets,
 * object key order) for scoring decisions.
 *
 * Evaluation proceeds in fixed stages, always in this order:
 *
 *  1. Construction terminology (positive)
 *  2. Contact information — email/phone (positive)
 *  3. Message length sanity (positive)
 *  4. Language detection (positive or negative)
 *  5. Non-Latin script (negative)
 *  6. Spam pattern groups (negative)
 *  7. Hyperlink volume (negative)
 *  8. Repetitive content (negative)
 *  9. Shouting / excessive punctuation (negative)
 *  10. Sender domain mismatch, if headers provided (negative)
 *
 * The returned score should not be interpreted as a spam probability.
 * Instead, it estimates whether the email is sufficiently relevant to justify
 * the cost of AI processing.
 *
 * @param subject Email subject.
 * @param body Raw email body.
 * @param headers Optional email headers for additional deterministic signals.
 *
 * @returns Evaluation result.
 */
export function evaluateEmail(
  subject: string,
  body: string,
  headers: EmailHeaders = {},
): EmailEvaluationResult {
  const rawText = `${subject}\n${body}`;
  const text = rawText.toLowerCase();

  const signals: ScoreSignal[] = [];

  /* ---------------------------------------------------------------------- */
  /* Stage 1: Construction Keywords                                         */
  /* ---------------------------------------------------------------------- */

  const { count: keywordCount, matched } = countConstructionKeywords(text);

  if (keywordCount > 0) {
    const delta = Math.min(
      keywordCount * SCORE_WEIGHTS.keywordPerMatch,
      SCORE_WEIGHTS.keywordMaxContribution,
    );
    signals.push({
      code: "construction_keywords",
      delta,
      reason: `${keywordCount} construction keyword(s): ${matched.join(", ")}`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 2: Contact Information                                           */
  /* ---------------------------------------------------------------------- */

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(rawText)) {
    signals.push({
      code: "email_address_present",
      delta: SCORE_WEIGHTS.emailAddressPresent,
      reason: "email address detected",
    });
  }

  if (/\+?\d[\d\s()-]{7,}/.test(rawText)) {
    signals.push({
      code: "phone_number_present",
      delta: SCORE_WEIGHTS.phoneNumberPresent,
      reason: "phone number detected",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 3: Length Sanity                                                 */
  /* ---------------------------------------------------------------------- */

  if (body.length > 100) {
    signals.push({
      code: "reasonable_length",
      delta: SCORE_WEIGHTS.reasonableLength,
      reason: "reasonable email length",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 4: Language Detection                                            */
  /* ---------------------------------------------------------------------- */

  const language = detectLanguage(text);

  if (language === "eng") {
    signals.push({
      code: "english_language",
      delta: SCORE_WEIGHTS.englishLanguage,
      reason: "english language",
    });
  } else if (language && language !== "und") {
    signals.push({
      code: "foreign_language",
      delta: SCORE_WEIGHTS.foreignLanguage,
      reason: `foreign language (${language})`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 5: Non-Latin Script                                              */
  /* ---------------------------------------------------------------------- */

  if (isNonLatinScript(rawText)) {
    signals.push({
      code: "non_latin_script",
      delta: SCORE_WEIGHTS.nonLatinScript,
      reason: "non-latin script",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 6: Spam Pattern Groups                                           */
  /* ---------------------------------------------------------------------- */

  const { totalCapped, details } = evaluateSpamPatternGroups(text);

  if (totalCapped > 0) {
    const activeGroups = details.filter((d) => d.capped > 0);
    signals.push({
      code: "spam_patterns",
      delta: totalCapped * SCORE_WEIGHTS.spamPatternPerMatch,
      reason: `${totalCapped} spam pattern match(es) across [${activeGroups
        .map((g) => `${g.name}:${g.capped}`)
        .join(", ")}]`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 7: Hyperlink Volume                                              */
  /* ---------------------------------------------------------------------- */

  const urlCount = (text.match(/https?:\/\//g) ?? []).length;

  if (urlCount > 2) {
    signals.push({
      code: "excessive_hyperlinks",
      delta: SCORE_WEIGHTS.excessiveHyperlinks,
      reason: `too many hyperlinks (${urlCount})`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 8: Repetitive Content                                            */
  /* ---------------------------------------------------------------------- */

  const words = text.match(/[a-z]{3,}/g) ?? [];
  const uniqueWordCount = new Set(words).size;

  if (words.length > 100 && uniqueWordCount / words.length < 0.35) {
    signals.push({
      code: "repetitive_content",
      delta: SCORE_WEIGHTS.repetitiveContent,
      reason: `highly repetitive content (${uniqueWordCount}/${words.length} unique)`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 9: Shouting / Excessive Punctuation                              */
  /* ---------------------------------------------------------------------- */

  const capsRatio = uppercaseRatio(rawText);

  if (capsRatio > 0.5) {
    signals.push({
      code: "excessive_capitalization",
      delta: SCORE_WEIGHTS.excessiveCapitalization,
      reason: `excessive capitalization (${Math.round(capsRatio * 100)}% uppercase)`,
    });
  }

  if (/^[A-Z0-9\s!?.,'"-]+$/.test(subject.trim()) && subject.trim().length > 6) {
    signals.push({
      code: "subject_all_caps",
      delta: SCORE_WEIGHTS.subjectAllCaps,
      reason: "subject line is fully capitalized",
    });
  }

  const punctuationSpamCount = excessivePunctuationCount(rawText);

  if (punctuationSpamCount > 0) {
    signals.push({
      code: "excessive_punctuation",
      delta: punctuationSpamCount * SCORE_WEIGHTS.excessivePunctuation,
      reason: `excessive punctuation runs (${punctuationSpamCount})`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stage 10: Sender Domain Mismatch                                       */
  /* ---------------------------------------------------------------------- */

  if (isSuspiciousSenderDomain(headers.from, headers.replyTo)) {
    signals.push({
      code: "suspicious_sender_domain",
      delta: SCORE_WEIGHTS.suspiciousSenderDomain,
      reason: `From/Reply-To domain mismatch (${extractSenderDomain(
        headers.from,
      )} vs ${extractSenderDomain(headers.replyTo)})`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Aggregate                                                              */
  /* ---------------------------------------------------------------------- */

  // Deterministic aggregation: signals were pushed in a fixed stage order
  // above, so reduce() over the array is stable and reproducible regardless
  // of engine/runtime.
  const score = signals.reduce((sum, s) => sum + s.delta, 0);

  return {
    score,
    language,
    signals,
    reasons: signals.map((s) => s.reason),
    shouldEvaluate: score >= MINIMUM_EVALUATION_SCORE,
  };
}