import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decideContractGrannyExclusionGate,
  describeGrannyExclusionConflicts,
  findGrannyExclusionConflicts,
  isGrannyOutOfScopeLine,
  type GrannyExclusionInput,
} from "../../lib/offer/granny-exclusion";
import { collectOfferSendBlockers } from "../../lib/offer/offer-readiness";
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

test("the refusal names the line and the step, and the Tender send asks for a revision", () => {
  const conflicts = findGrannyExclusionConflicts(offer());

  const inPlace = describeGrannyExclusionConflicts(conflicts, { revisionNeeded: false });
  assert.match(inPlace, /"Granny flat \(not in current scope\)"/);
  assert.match(inPlace, /on the Offer document step/);
  assert.doesNotMatch(inPlace, /revision/);

  const locked = describeGrannyExclusionConflicts(conflicts, { revisionNeeded: true });
  assert.match(locked, /Create a revision/);
});

test("a Contract whose Tender went out before the check carries what the customer signed", () => {
  const gate = decideContractGrannyExclusionGate({
    conflicts: findGrannyExclusionConflicts(offer()),
    tenderSentWithCheck: false,
  });

  assert.ok(gate.kind === "as-signed", `expected as-signed, got ${gate.kind}`);
  assert.match(gate.warning, /"Granny flat \(not in current scope\)"/);
});

test("the Contract refusal never asks for a revision, which a signed Tender cannot have", () => {
  const conflicts = findGrannyExclusionConflicts(offer());
  const gate = decideContractGrannyExclusionGate({
    conflicts,
    tenderSentWithCheck: true,
  });

  assert.ok(gate.kind === "refuse", `expected refuse, got ${gate.kind}`);
  assert.match(gate.error, /"Granny flat \(not in current scope\)"/);
  assert.doesNotMatch(gate.error, /create a revision/i);
  assert.equal(
    decideContractGrannyExclusionGate({ conflicts: [], tenderSentWithCheck: true }).kind,
    "clear",
  );
});

test("the readiness strip blocks the send and jumps to the step that holds the line", () => {
  const blockers = collectOfferSendBlockers({
    hasLead: true,
    needsOverrideReason: false,
    expiryState: "valid",
    grannyExclusionConflicts: findGrannyExclusionConflicts(offer()),
  });
  const blocker = blockers.find((b) => b.id.startsWith("granny-exclusion"));

  assert.ok(blocker, "expected a granny-exclusion blocker");
  assert.equal(blocker.severity, "block");
  assert.equal(blocker.stepId, "offer-step-offer-document");
  assert.match(blocker.label, /Granny flat \(not in current scope\)/);
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
