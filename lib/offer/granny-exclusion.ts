import type { OfferWorkspaceSnapshot } from "./workspace-persistence";

// A build that includes a granny flat must not go out with an exclusion saying
// the granny flat is not in scope. That line is seeded on every new offer
// (OFFER_EXCLUDES_BULLETS) and admin content can carry it too, so an estimator
// who adds a granny flat sends a document that prices it on one page and
// excludes it on another.
//
// Directive-free so the rule is shared by the send-readiness strip and every
// send action, and can be unit-tested.

type GrannyExclusionStepId = "offer-step-offer-document" | "offer-step-scope";

export type GrannyExclusionConflict = {
  // The printed text to remove, as the estimator will find it.
  readonly line: string;
  // Where it is edited: the Offer document step holds the bullets (including
  // those seeded from admin content), the Scope step the ticked exclusions.
  readonly stepId: GrannyExclusionStepId;
};

export type GrannyExclusionInput = Pick<
  OfferWorkspaceSnapshot,
  "draft" | "exclusions"
> & {
  readonly job: Pick<
    OfferWorkspaceSnapshot["job"],
    "hasGrannyHome" | "grannyFlatSqm"
  >;
};

// Either field puts a granny flat on the documents: the toggle prints the
// granny home specification, and a granny-flat area prints on the area table
// and reaches the price.
export function buildIncludesGrannyFlat(
  job: GrannyExclusionInput["job"],
): boolean {
  return job.hasGrannyHome || job.grannyFlatSqm > 0;
}

// "not in scope", "not in current scope", "not in the current scope".
const NOT_IN_SCOPE = /\bnot in (?:the )?(?:current )?scope\b/;

// What must be left once that statement and its brackets or dashes are gone:
// the granny flat alone, singular or plural.
// "secondary dwelling" is the planning term for the same thing, and is a
// complete subject on its own: "Secondary dwelling (not in scope)" contradicts
// a build that includes one exactly as the granny wording does.
const GRANNY_FLAT_ALONE =
  /^(?:(?:the|a|any) )?(?:(?:secondary dwellings?)|(?:secondary dwellings? )?granny ?(?:flat|home)s?(?: secondary dwellings?)?)(?: (?:is|are))?$/;

// Narrow on purpose: the granny flat must be the whole subject of the line.
// "Granny flat landscaping (not in current scope)" and "Granny flat site costs"
// are legitimate exclusions for a build that includes one.
export function isGrannyOutOfScopeLine(line: string): boolean {
  const text = line.replace(/\s+/g, " ").trim().toLowerCase();
  if (!NOT_IN_SCOPE.test(text)) {
    return false;
  }
  const subject = text
    .replace(NOT_IN_SCOPE, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
  return GRANNY_FLAT_ALONE.test(subject);
}

// Checks every exclusion the documents print: the draft bullets (seeded or
// admin-derived) and the Scope exclusions ticked for the document, including
// the detail the Tender prints beside each.
export function findGrannyExclusionConflicts(
  snapshot: GrannyExclusionInput,
): readonly GrannyExclusionConflict[] {
  if (!buildIncludesGrannyFlat(snapshot.job)) {
    return [];
  }
  const conflicts = new Map<string, GrannyExclusionConflict>();
  const add = (text: string, stepId: GrannyExclusionStepId) => {
    const line = text.trim();
    if (isGrannyOutOfScopeLine(line)) {
      conflicts.set(`${stepId}|${line}`, { line, stepId });
    }
  };
  for (const bullet of snapshot.draft.exclusionBullets) {
    add(bullet, "offer-step-offer-document");
  }
  for (const item of snapshot.exclusions) {
    if (!item.includedInOfferDocument) {
      continue;
    }
    add(item.label, "offer-step-scope");
    add(item.description, "offer-step-scope");
    add(item.variationRule, "offer-step-scope");
  }
  return [...conflicts.values()];
}

// The refusal and the readiness label. `revisionNeeded` is for the Tender send:
// by then the Offer document and Scope steps are locked, so the line can only be
// removed on a new revision, which is still allowed there. The Contract send

/**
 * The same list with any "granny flat is out of scope" line taken out, when the
 * build includes one. Nothing that prints or stores an exclusion list should
 * carry a line contradicting the build, and asking the estimator to notice and
 * delete it (the old readiness blocker and the server refusals) put the work on
 * the wrong side. The narrowness of isGrannyOutOfScopeLine is what makes this
 * safe: only a line whose whole subject is the granny flat is dropped, so
 * "Granny flat landscaping (not in current scope)" survives.
 */
export function withoutGrannyOutOfScopeLines<T>(
  includesGrannyFlat: boolean,
  items: readonly T[],
  labelOf: (item: T) => string,
): readonly T[] {
  if (!includesGrannyFlat) {
    return items;
  }
  const kept = items.filter((item) => !isGrannyOutOfScopeLine(labelOf(item)));
  return kept.length === items.length ? items : kept;
}
