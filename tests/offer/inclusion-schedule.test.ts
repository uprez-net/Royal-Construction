import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STANDARD_INCLUSION_SPECIFICATIONS,
  STANDARD_INCLUSIONS_SCHEDULE,
} from "../../lib/offer/workspace-proposal-content";
import {
  INITIAL_COST_LINES,
  INITIAL_OFFER_DRAFT,
  mergeCostScheduleIntoSchedule,
  type OfferWorkspaceCostLine,
} from "../../lib/offer/workspace-model";
import {
  CURRENT_WORKSPACE_SCHEMA_VERSION,
  migrateWorkspaceState,
} from "../../lib/offer/workspace-persistence";

// REGRESSION: the state schema pinned `schemaVersion: z.literal(2)` while
// serialize wrote CURRENT_WORKSPACE_SCHEMA_VERSION. Bumping the constant made
// every parse throw — and resolveOfferContractValue swallows that in a catch,
// so the only visible symptom was contract values silently rendering as "—".
// The literal is now derived from the constant; this pins them together.
test("the parsed schema version tracks the current schema version constant", () => {
  const migrated = migrateWorkspaceState({ schemaVersion: 1, job: {} }) as {
    schemaVersion: number;
  };

  assert.equal(migrated.schemaVersion, CURRENT_WORKSPACE_SCHEMA_VERSION);
});

test("STANDARD_INCLUSION_SPECIFICATIONS is every template specification, in order", () => {
  assert.deepEqual(
    STANDARD_INCLUSION_SPECIFICATIONS,
    STANDARD_INCLUSIONS_SCHEDULE.map((row) => row.specification),
  );
});

test("a new offer draft seeds the full template schedule", () => {
  assert.deepEqual(
    INITIAL_OFFER_DRAFT.inclusionSchedule,
    STANDARD_INCLUSION_SPECIFICATIONS,
  );
});

test("v2 snapshots migrate to v3 seeded with the template schedule", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 2,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: ["A"],
      exclusionBullets: [],
      termsSummary: "T",
    },
  }) as { schemaVersion: number; draft: { inclusionSchedule: string[] } };

  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(
    migrated.draft.inclusionSchedule,
    STANDARD_INCLUSION_SPECIFICATIONS,
  );
});

test("migration does not clobber a schedule that is already present", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 2,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: [],
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: ["Only this one"],
    },
  }) as { draft: { inclusionSchedule: string[] } };

  assert.deepEqual(migrated.draft.inclusionSchedule, ["Only this one"]);
});

test("an estimator who empties the schedule keeps it empty through v3", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 3,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: [],
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: [],
    },
  }) as { draft: { inclusionSchedule: string[] } };

  assert.deepEqual(migrated.draft.inclusionSchedule, []);
});

// ─── Pulling cost-schedule wording into the schedule (Task 2) ───

function costLine(
  overrides: Partial<OfferWorkspaceCostLine>,
): OfferWorkspaceCostLine {
  return {
    ...INITIAL_COST_LINES[0],
    id: "test-line",
    includedInContract: true,
    costExGst: 1000,
    offerTenderLineItem: "Test wording",
    ...overrides,
  };
}

test("pulling from the cost schedule appends only missing wording", () => {
  const result = mergeCostScheduleIntoSchedule(
    ["Existing spec", "Shared wording"],
    [
      costLine({ id: "a", offerTenderLineItem: "Shared wording" }),
      costLine({ id: "b", offerTenderLineItem: "New wording" }),
    ],
  );

  assert.deepEqual(result, ["Existing spec", "Shared wording", "New wording"]);
});

test("pulling ignores excluded and unpriced cost lines", () => {
  const result = mergeCostScheduleIntoSchedule(
    [],
    [
      costLine({
        id: "a",
        includedInContract: false,
        offerTenderLineItem: "Excluded",
      }),
      costLine({ id: "b", costExGst: 0, offerTenderLineItem: "Unpriced" }),
      costLine({ id: "c", offerTenderLineItem: "   " }),
      costLine({ id: "d", offerTenderLineItem: "Kept" }),
    ],
  );

  assert.deepEqual(result, ["Kept"]);
});

test("pulling is idempotent", () => {
  const lines = [costLine({ id: "a", offerTenderLineItem: "Once" })];
  const once = mergeCostScheduleIntoSchedule([], lines);
  const twice = mergeCostScheduleIntoSchedule(once, lines);

  assert.deepEqual(twice, once);
});
