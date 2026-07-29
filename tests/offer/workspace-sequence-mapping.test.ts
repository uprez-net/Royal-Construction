import assert from "node:assert/strict";
import {
  OFFER_BUILDING_SEQUENCE_STEPS,
  OFFER_SEQUENCE_MAPPINGS,
  getOfferSequenceMappingStats,
} from "../../lib/offer/workspace-sequence-mapping";

const stats = getOfferSequenceMappingStats(OFFER_SEQUENCE_MAPPINGS);

assert.deepEqual(stats, {
  totalTasks: 71,
  sequenceLinkedTasks: 39,
  projectHandoffTasks: 37,
});

assert.equal(
  OFFER_SEQUENCE_MAPPINGS.some(
    (mapping) =>
      mapping.taskName === "SLAB" &&
      mapping.buildingSequenceTasks.includes("Piering & Pouring") &&
      mapping.tradesToBook.includes("Concretor") &&
      mapping.milestoneStages.includes("(2) Slab 15%"),
  ),
  true,
);

assert.equal(
  OFFER_SEQUENCE_MAPPINGS.some(
    (mapping) =>
      mapping.taskName === "PLUMBER" &&
      mapping.offerTenderWording.includes("final vanity/kitchen sanitaryware"),
  ),
  true,
);

// ─── OFFER_BUILDING_SEQUENCE_STEPS (issue #112) ───
// The suggestion catalog the Calculation workbook offers when a building-sequence
// step is added by hand: the deduped, sorted union of every step across the
// mappings.

// Non-empty and free of blank entries.
assert.ok(OFFER_BUILDING_SEQUENCE_STEPS.length > 0);
assert.equal(
  OFFER_BUILDING_SEQUENCE_STEPS.every((step) => step.trim().length > 0),
  true,
);

// De-duplicated — every entry appears exactly once.
assert.equal(
  new Set(OFFER_BUILDING_SEQUENCE_STEPS).size,
  OFFER_BUILDING_SEQUENCE_STEPS.length,
);

// Case-insensitively sorted, so the suggestion list reads predictably.
assert.deepEqual(
  [...OFFER_BUILDING_SEQUENCE_STEPS],
  [...OFFER_BUILDING_SEQUENCE_STEPS].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  ),
);

// It is the exact union of the per-mapping steps — nothing dropped, nothing
// invented. Every catalog step is suggestable, and every suggestion traces back
// to a real mapping. Blanks are filtered on BOTH sides so this stays an exact
// union check of the catalog's real contract (dedupe + drop-blanks + sort)
// rather than silently depending on the source data never containing a blank.
const everyMappingStep = new Set(
  OFFER_SEQUENCE_MAPPINGS.flatMap((mapping) => mapping.buildingSequenceTasks).filter(
    (step) => step.trim().length > 0,
  ),
);
assert.equal(OFFER_BUILDING_SEQUENCE_STEPS.length, everyMappingStep.size);
assert.equal(
  OFFER_BUILDING_SEQUENCE_STEPS.every((step) => everyMappingStep.has(step)),
  true,
);

// Known real steps are present.
assert.ok(OFFER_BUILDING_SEQUENCE_STEPS.includes("Piering & Pouring"));
assert.ok(OFFER_BUILDING_SEQUENCE_STEPS.includes("Waterproofing"));

// "Steel reinforcement" appears in both the SLAB and STEEL mappings, so it must
// be collapsed to a single suggestion.
assert.equal(
  OFFER_BUILDING_SEQUENCE_STEPS.filter((step) => step === "Steel reinforcement")
    .length,
  1,
);
