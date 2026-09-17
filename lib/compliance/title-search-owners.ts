/**
 * Comparing the names on a title search against the owners we hold.
 *
 * The land registry lags settlement. A surveyor orders a title search in good
 * faith, the register has not been updated yet, and what comes back names the
 * people who sold the place — which the surveyor has no way of knowing is
 * wrong, because they never knew who bought it. So this is not something a
 * party tells us; it is something only we can see, because only we hold the
 * contract that says whose job this is.
 *
 * Pure on purpose, and separate from the agent that reads the document. The
 * extraction is a model call and the comparison is a rule, and mixing them
 * would make the rule untestable and the failure mode ("did the model think
 * they match?") unanswerable. The model transcribes names; this decides.
 */

/**
 * Honorifics and post-nominals, dropped from both sides.
 *
 * A contract says "Mr John Smith" and a title search says "SMITH John" — the
 * title is noise on one side only, and keeping it would cost the match.
 */
const NAME_NOISE = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "dr",
  "prof",
  "sir",
  "dame",
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "the",
]);

/**
 * Company and trust suffixes, dropped so the distinctive part is what matches.
 *
 * "Smith Holdings Pty Ltd" and "SMITH HOLDINGS PTY LIMITED" are one owner. The
 * suffix is also the least distinctive part of the name: leaving it in means
 * two unrelated companies share a token and edge closer to matching.
 */
const ENTITY_NOISE = new Set([
  "pty",
  "ltd",
  "limited",
  "proprietary",
  "inc",
  "incorporated",
  "co",
  "company",
  "trust",
  "trustee",
  "trustees",
  "atf",
  "as",
  "nominees",
  "holdings",
  "superannuation",
  "super",
  "fund",
  "smsf",
]);

/**
 * A name reduced to comparable tokens.
 *
 * Sorted, so "Smith, John" and "John Smith" are the same name — the register
 * writes surname first and a contract writes it last, and that difference is
 * pure formatting. Deduplicated, so a repeated token cannot make a name look
 * longer than it is.
 *
 * Deliberately close in shape to `addressTokens` in lib/graph/certifier-subject:
 * same problem, same answer — normalise both sides until only the disagreement
 * that matters is left.
 */
export function nameTokens(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const raw = value
    .toLowerCase()
    .normalize("NFKD")
    // Combining marks, so "Renée" and "Renee" are one person.
    .replace(/[̀-ͯ]/g, "")
    // Apostrophes close up rather than splitting: "O'Brien" and "OBrien".
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!raw) {
    return [];
  }

  const tokens = raw
    .split(" ")
    .filter(
      (token) => token && !NAME_NOISE.has(token) && !ENTITY_NOISE.has(token),
    );

  return [...new Set(tokens)].sort();
}

/**
 * Whether two names are the same person.
 *
 * Containment rather than equality, in one direction or the other: a contract
 * carries "John Andrew Smith" where the register carries "John Smith", and a
 * middle name present on one side only must not cost the match. What it will
 * not do is match on a surname alone — "Smith" against "John Smith" leaves the
 * shorter side one token long, and a single shared token is a coincidence
 * rather than an identification.
 *
 * The asymmetry is deliberate and the threshold is the whole safety margin:
 * this decides whether to raise an alert on a document somebody has to go and
 * re-order, so it errs towards calling names the same.
 */
export function isSameOwnerName(left: string, right: string): boolean {
  const a = nameTokens(left);
  const b = nameTokens(right);

  if (a.length === 0 || b.length === 0) {
    return false;
  }

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

  // One token is a surname or a company's distinctive word on its own. Too
  // little to identify anybody, and the commonest surnames would match half a
  // suburb.
  if (shorter.length < 2) {
    return (
      shorter.length === 1 && longer.length === 1 && shorter[0] === longer[0]
    );
  }

  const set = new Set(longer);
  return shorter.every((token) => set.has(token));
}

/** What the comparison found, and why. */
export type TitleSearchOwnerMatch =
  | {
      /** At least one owner we hold appears on the document. */
      verdict: "match";
      matched: string[];
    }
  | {
      /** The document names nobody we hold. This is the alert. */
      verdict: "mismatch";
      documentOwners: string[];
      projectOwners: string[];
    }
  | {
      /**
       * Nothing to compare — no owners on the project, or none readable on the
       * document. Not a pass and not a failure: we have no opinion, and saying
       * so is what keeps an unreadable scan from raising an alert nobody can
       * act on.
       */
      verdict: "indeterminate";
      reason: string;
    };

/**
 * Compares the proprietors on a title search against the owners on the project.
 *
 * A match is any overlap, not agreement on the whole list. Two people buy a
 * house and one of them is on the title; a company owns it and the contract
 * names the director as well. Requiring both lists to agree would raise an
 * alert on the ordinary case, which is the fastest way to teach everyone to
 * ignore the alerts.
 *
 * A mismatch is therefore total: the register names nobody the contract does,
 * which is what a search predating the transfer actually looks like.
 */
export function compareTitleSearchOwners(params: {
  documentOwners: readonly string[];
  projectOwners: readonly string[];
}): TitleSearchOwnerMatch {
  const documentOwners = params.documentOwners
    .map((name) => name.trim())
    .filter((name) => nameTokens(name).length > 0);
  const projectOwners = params.projectOwners
    .map((name) => name.trim())
    .filter((name) => nameTokens(name).length > 0);

  if (projectOwners.length === 0) {
    return {
      verdict: "indeterminate",
      reason:
        "This project has no owner names recorded, so there is nothing to check the title search against.",
    };
  }

  if (documentOwners.length === 0) {
    return {
      verdict: "indeterminate",
      reason: "No registered proprietor could be read off the title search.",
    };
  }

  const matched = projectOwners.filter((owner) =>
    documentOwners.some((candidate) => isSameOwnerName(owner, candidate)),
  );

  if (matched.length > 0) {
    return { verdict: "match", matched };
  }

  return { verdict: "mismatch", documentOwners, projectOwners };
}

/** The alert's detail line: what the register says versus what we hold. */
export function describeOwnerMismatch(
  documentOwners: readonly string[],
  projectOwners: readonly string[],
): string {
  return (
    `The title search names ${documentOwners.join(", ")}. ` +
    `This project's owners are ${projectOwners.join(", ")}. ` +
    "The register has most likely not been updated since settlement — ask the surveyor for a fresh search."
  );
}
