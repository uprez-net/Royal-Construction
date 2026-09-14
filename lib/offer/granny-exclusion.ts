import { OFFER_WORKFLOW_STEPS } from "./workflow-steps";
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
const GRANNY_FLAT_ALONE =
  /^(?:(?:the|a|any) )?(?:secondary dwelling )?granny ?(?:flat|home)s?(?: secondary dwelling)?(?: (?:is|are))?$/;

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

function stepLabel(stepId: GrannyExclusionStepId): string {
  return (
    OFFER_WORKFLOW_STEPS.find((step) => step.sectionId === stepId)?.label ??
    stepId
  );
}

function joinAnd(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// The refusal and the readiness label. `revisionNeeded` is for the Tender and
// Contract sends: by then the Offer document and Scope steps are locked, so the
// line can only be removed on a new revision.
export function describeGrannyExclusionConflicts(
  conflicts: readonly GrannyExclusionConflict[],
  options: { readonly revisionNeeded: boolean },
): string {
  const lines = [...new Set(conflicts.map((c) => `"${c.line}"`))];
  const steps = [...new Set(conflicts.map((c) => stepLabel(c.stepId)))];
  const those = lines.length === 1 ? "that line" : "those lines";
  const where = `on the ${joinAnd(steps)} step${steps.length === 1 ? "" : "s"}`;
  const fix = options.revisionNeeded
    ? `Create a revision and remove ${those} ${where} before sending.`
    : `Remove ${those} ${where} before sending.`;
  return `This build includes a granny flat, but its exclusions still say ${joinAnd(lines)}. ${fix}`;
}
