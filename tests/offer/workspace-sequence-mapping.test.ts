import assert from "node:assert/strict";
import {
  OFFER_SEQUENCE_MAPPINGS,
  getOfferSequenceMappingStats,
} from "../../lib/offer/workspace-sequence-mapping";

const stats = getOfferSequenceMappingStats(OFFER_SEQUENCE_MAPPINGS);

assert.deepEqual(stats, {
  totalTasks: 74,
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
