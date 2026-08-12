import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STANDARD_INCLUSION_SPECIFICATIONS,
  STANDARD_INCLUSIONS_SCHEDULE,
} from "../../lib/offer/workspace-proposal-content";
import { INITIAL_OFFER_DRAFT } from "../../lib/offer/workspace-model";
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
