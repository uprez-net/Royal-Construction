import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";

import {
  findGrannyExclusionConflicts,
  isGrannyOutOfScopeLine,
  withoutGrannyOutOfScopeLines,
  type GrannyExclusionInput,
} from "../../lib/offer/granny-exclusion";
import {
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
} from "../../lib/offer/workspace-model";

// Every new offer is seeded with the exclusion "Granny flat (not in current
// scope)", and admin content can carry it too. An estimator who then added a
// granny flat sent a proposal, Tender and Contract that priced the granny flat
// and excluded it in the same document. The Contract send then refused such an
// offer with "Create a revision", which the app locks once the Tender is signed,
// so a deal whose Tender went out before the check could never get its Contract.

const SEEDED_LINE = "Granny flat (not in current scope)";

function offer(overrides: Partial<GrannyExclusionInput> = {}): GrannyExclusionInput {
  return {
    job: { ...INITIAL_OFFER_JOB, hasGrannyHome: true },
    draft: INITIAL_OFFER_DRAFT,
    exclusions: INITIAL_EXCLUSIONS,
    ...overrides,
  };
}

test("the seeded exclusion conflicts with a build that includes a granny flat", () => {
  assert.ok(INITIAL_OFFER_DRAFT.exclusionBullets.includes(SEEDED_LINE));
  assert.deepEqual(findGrannyExclusionConflicts(offer()), [
    { line: SEEDED_LINE, stepId: "offer-step-offer-document" },
  ]);
});

test("a granny-flat area counts even without the toggle", () => {
  const conflicts = findGrannyExclusionConflicts(
    offer({ job: { ...INITIAL_OFFER_JOB, hasGrannyHome: false, grannyFlatSqm: 60 } }),
  );
  assert.equal(conflicts.length, 1);
});

test("no granny flat, no conflict", () => {
  assert.equal(INITIAL_OFFER_JOB.hasGrannyHome, false);
  assert.equal(INITIAL_OFFER_JOB.grannyFlatSqm, 0);
  assert.deepEqual(
    findGrannyExclusionConflicts(offer({ job: INITIAL_OFFER_JOB })),
    [],
  );
});

test("the conflict clears once the line is removed", () => {
  const draft = {
    ...INITIAL_OFFER_DRAFT,
    exclusionBullets: INITIAL_OFFER_DRAFT.exclusionBullets.filter(
      (line) => line !== SEEDED_LINE,
    ),
  };
  assert.deepEqual(findGrannyExclusionConflicts(offer({ draft })), []);
});

test("a ticked Scope exclusion is found on the Scope step; an unticked one is not printed", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: [] };
  const scopeItem = {
    ...INITIAL_EXCLUSIONS[0],
    id: "granny",
    label: "Secondary dwelling",
    description: "Granny flat not in scope",
    includedInOfferDocument: true,
  };

  assert.deepEqual(
    findGrannyExclusionConflicts(offer({ draft, exclusions: [scopeItem] })),
    [{ line: "Granny flat not in scope", stepId: "offer-step-scope" }],
  );
  assert.deepEqual(
    findGrannyExclusionConflicts(
      offer({ draft, exclusions: [{ ...scopeItem, includedInOfferDocument: false }] }),
    ),
    [],
  );
});

test("matching is narrow: the line must be the granny flat alone, said to be out of scope", () => {
  for (const line of [
    SEEDED_LINE,
    "  GRANNY   flat (Not in   scope) ",
    "Granny-flat: not in the current scope",
    "Granny home (not in current scope)",
    "Granny flats (not in current scope)",
    "Granny flat / secondary dwelling - not in scope",
  ]) {
    assert.equal(isGrannyOutOfScopeLine(line), true, `"${line}" missed`);
  }
  for (const line of [
    "Granny flat landscaping",
    "Granny flat site costs and connections",
    // A part of the granny flat left out of a build that includes it.
    "Granny flat landscaping (not in current scope)",
    "Granny flat driveway & fencing (not in current scope)",
    "Pool (not in current scope)",
    "Anything not in current scope",
  ]) {
    assert.equal(isGrannyOutOfScopeLine(line), false, `"${line}" flagged`);
  }
});





test("the planning term for a granny flat is the same subject", () => {
  for (const line of [
    "Secondary dwelling (not in scope)",
    "Secondary dwelling (not in current scope)",
    "Secondary dwellings (not in the current scope)",
    "The secondary dwelling is not in scope",
  ]) {
    assert.equal(isGrannyOutOfScopeLine(line), true, `missed ${line}`);
  }
});

test("a secondary dwelling named inside a wider exclusion is left alone", () => {
  for (const line of [
    "Council Development & Secondary Dwelling contribution",
    "Secondary dwelling landscaping (not in current scope)",
    "Secondary dwelling site costs",
  ]) {
    assert.equal(isGrannyOutOfScopeLine(line), false, `wrongly flagged ${line}`);
  }
});

// The conflict is no longer the estimator's to fix: a build that includes a
// granny flat has the contradicting line removed from the workspace as soon as
// the build says so, and every document filters it again at build time. The
// readiness blockers and the four server refusals that used to stop the send
// are gone.

const source = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the line is dropped only when the build includes a granny flat", () => {
  const lines = ["Granny flat (not in current scope)", "Landscaping (not in scope)"];
  assert.deepEqual(
    [...withoutGrannyOutOfScopeLines(true, lines, (line) => line)],
    ["Landscaping (not in scope)"],
  );
  assert.deepEqual([...withoutGrannyOutOfScopeLines(false, lines, (line) => line)], lines);
});

test("a list with nothing to drop is handed back unchanged", () => {
  const lines = ["Landscaping (not in scope)"];
  assert.equal(withoutGrannyOutOfScopeLines(true, lines, (line) => line), lines);
});

test("a wider exclusion naming the granny flat survives the removal", () => {
  const lines = [
    "Granny flat landscaping (not in current scope)",
    "Council Development & Secondary Dwelling contribution",
    "Granny flat (not in current scope)",
  ];
  assert.deepEqual(
    [...withoutGrannyOutOfScopeLines(true, lines, (line) => line)],
    [
      "Granny flat landscaping (not in current scope)",
      "Council Development & Secondary Dwelling contribution",
    ],
  );
});

test("every document filters the line", () => {
  const print = source("lib/offer/workspace-print-template.ts");
  assert.ok(
    print.includes("exclusionBullets: withoutGrannyOutOfScopeLines("),
    "the offer document bullets are not filtered",
  );
  assert.ok(
    print.includes("exclusionRows: withoutGrannyOutOfScopeLines("),
    "the exclusion rows are not filtered",
  );
  assert.ok(
    source("lib/offer/project-handoff-commercials.ts").includes(
      "withoutGrannyOutOfScopeLines(",
    ),
    "the BC4 and project list is not filtered",
  );
});

test("no send path refuses the offer over the line any more", () => {
  for (const path of [
    "lib/data/offer-send.ts",
    "lib/data/offer-accept-sign.ts",
    "lib/data/offer-tender-sign.ts",
    "lib/data/offer-contract-sign.ts",
    "lib/offer/offer-readiness.ts",
  ]) {
    const text = source(path);
    for (const gone of [
      "findGrannyExclusionConflicts",
      "describeGrannyExclusionConflicts",
      "decideContractGrannyExclusionGate",
    ]) {
      assert.ok(!text.includes(gone), `${path} still uses ${gone}`);
    }
  }
});

test("the workspace strips the line when the build gains a granny flat", () => {
  const workspace = source("components/offers/new-workflow/new-offer-workspace.tsx");
  assert.ok(
    workspace.includes("function dropGrannyExclusionsFor("),
    "no removal helper in the workspace",
  );
  assert.ok(
    workspace.includes("setJob(nextJob);\n    dropGrannyExclusionsFor(nextJob);"),
    "the job funnel does not strip",
  );
  assert.ok(
    workspace.includes("dropGrannyExclusionsFor({\n        ...job,"),
    "the area import does not strip",
  );
});
