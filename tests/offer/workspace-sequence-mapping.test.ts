import assert from "node:assert/strict";
import { test } from "vitest";

import {
  OFFER_BUILDING_SEQUENCE_STEPS,
  OFFER_SEQUENCE_MAPPINGS,
  getOfferSequenceMappingStats,
} from "@/lib/offer/workspace-sequence-mapping";

test("the mapping table's shape is pinned", () => {
  assert.deepEqual(getOfferSequenceMappingStats(OFFER_SEQUENCE_MAPPINGS), {
    totalTasks: 71,
    sequenceLinkedTasks: 39,
    projectHandoffTasks: 37,
  });
});

test("SLAB carries its sequence tasks, trade and milestone stage", () => {
  assert.equal(
    OFFER_SEQUENCE_MAPPINGS.some(
      (mapping) =>
        mapping.taskName === "SLAB"
        && mapping.buildingSequenceTasks.includes("Piering & Pouring")
        && mapping.tradesToBook.includes("Concretor")
        && mapping.milestoneStages.includes("(2) Slab 15%"),
    ),
    true,
  );
});

test("PLUMBER keeps the tender wording the client reads", () => {
  assert.equal(
    OFFER_SEQUENCE_MAPPINGS.some(
      (mapping) =>
        mapping.taskName === "PLUMBER"
        && mapping.offerTenderWording.includes(
          "final vanity/kitchen sanitaryware",
        ),
    ),
    true,
  );
});

// ─── OFFER_BUILDING_SEQUENCE_STEPS (issue #112) ───
// The suggestion catalog the Calculation workbook offers when a building-sequence
// step is added by hand: the deduped, sorted union of every step across the
// mappings.

test("the suggestion catalog is non-empty and free of blank entries", () => {
  assert.ok(OFFER_BUILDING_SEQUENCE_STEPS.length > 0);
  assert.equal(
    OFFER_BUILDING_SEQUENCE_STEPS.every((step) => step.trim().length > 0),
    true,
  );
});

test("every catalog entry appears exactly once", () => {
  assert.equal(
    new Set(OFFER_BUILDING_SEQUENCE_STEPS).size,
    OFFER_BUILDING_SEQUENCE_STEPS.length,
  );
});

test("the catalog is case-insensitively sorted, so it reads predictably", () => {
  assert.deepEqual(
    [...OFFER_BUILDING_SEQUENCE_STEPS],
    [...OFFER_BUILDING_SEQUENCE_STEPS].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    ),
  );
});

test("the catalog is the exact union of the per-mapping steps", () => {
  // Nothing dropped, nothing invented. Every catalog step is suggestable, and
  // every suggestion traces back to a real mapping. Blanks are filtered on BOTH
  // sides so this stays an exact union check of the catalog's real contract
  // (dedupe + drop-blanks + sort) rather than silently depending on the source
  // data never containing a blank.
  const everyMappingStep = new Set(
    OFFER_SEQUENCE_MAPPINGS.flatMap(
      (mapping) => mapping.buildingSequenceTasks,
    ).filter((step) => step.trim().length > 0),
  );
  assert.equal(OFFER_BUILDING_SEQUENCE_STEPS.length, everyMappingStep.size);
  assert.equal(
    OFFER_BUILDING_SEQUENCE_STEPS.every((step) => everyMappingStep.has(step)),
    true,
  );
});

test("known real steps are present", () => {
  assert.ok(OFFER_BUILDING_SEQUENCE_STEPS.includes("Piering & Pouring"));
  assert.ok(OFFER_BUILDING_SEQUENCE_STEPS.includes("Waterproofing"));
});

test("a step shared by two mappings collapses to a single suggestion", () => {
  // "Steel reinforcement" appears in both the SLAB and STEEL mappings.
  assert.equal(
    OFFER_BUILDING_SEQUENCE_STEPS.filter(
      (step) => step === "Steel reinforcement",
    ).length,
    1,
  );
});
