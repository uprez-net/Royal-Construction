import assert from "node:assert/strict";
import {
  INITIAL_PAYMENT_SCHEDULE,
  getPaymentScheduleTotalPct,
} from "../../lib/offer/workspace-payment-schedule";
import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  applyTaskMappingToCostLine,
  getIncludedOfferTenderLineItems,
  updateOfferScopeItems,
} from "../../lib/offer/workspace-model";

assert.equal(getPaymentScheduleTotalPct(INITIAL_PAYMENT_SCHEDULE), 1);
assert.deepEqual(
  INITIAL_PAYMENT_SCHEDULE.map((row) => ({
    stageName: row.stageName,
    percentOfContract: row.percentOfContract,
    trigger: row.trigger,
  })),
  [
    {
      stageName: "Deposit",
      percentOfContract: 0.05,
      trigger: "On signing of MBA Contract",
    },
    {
      stageName: "Foundation",
      percentOfContract: 0.15,
      trigger: "Slab complete",
    },
    {
      stageName: "Frame",
      percentOfContract: 0.25,
      trigger: "Frame complete and inspected",
    },
    {
      stageName: "Lock-up",
      percentOfContract: 0.25,
      trigger: "Windows, doors and roofing complete",
    },
    {
      stageName: "Interior fit-out",
      percentOfContract: 0.2,
      trigger: "Internal linings, kitchen and flooring in",
    },
    {
      stageName: "Handover",
      percentOfContract: 0.1,
      trigger: "Keys to client",
    },
  ],
);

const updatedAllowances = updateOfferScopeItems(
  INITIAL_ALLOWANCES,
  "allowance-1",
  {
    amount: 9500,
  },
);

assert.equal(updatedAllowances[0]?.amount, 9500);
assert.equal(INITIAL_ALLOWANCES[0]?.amount, 8500);
assert.equal(updatedAllowances[1], INITIAL_ALLOWANCES[1]);

// A fresh offer keeps the full cost-schedule structure but starts at $0 — no
// sample figures (see INITIAL_COST_BY_TASK).
assert.equal(INITIAL_COST_LINES.length, 71);
assert.equal(INITIAL_COST_LINES.filter((line) => line.costExGst > 0).length, 0);
assert.ok(INITIAL_COST_LINES.every((line) => line.costExGst === 0));

const slabLine = INITIAL_COST_LINES.find((line) => line.itemName === "SLAB");
assert.ok(slabLine);
assert.deepEqual(slabLine.buildingSequenceTasks, [
  "Piering & Pouring",
  "Steel reinforcement",
  "Formwork Check",
  "Slab gets poured",
]);
assert.ok(slabLine.offerTenderLineItem.includes("H1-class structural slab"));

// Cost-gated: a fresh $0 offer surfaces no priced line items (the preview
// falls back to the standard inclusion bullets until costs are entered).
assert.deepEqual(getIncludedOfferTenderLineItems(INITIAL_COST_LINES), []);

const blankMappedLine = applyTaskMappingToCostLine(
  {
    id: "manual-1",
    stageCode: "A",
    itemName: "",
    buildingSequenceTasks: [],
    offerTenderLineItem: "",
    tradeOrVendor: "",
    notesOrSpec: "",
    costExGst: 0,
    includedInContract: true,
  },
  "PLUMBER",
);
assert.equal(blankMappedLine.itemName, "PLUMBER");
assert.ok(
  blankMappedLine.buildingSequenceTasks.includes("Stormwater plumbing"),
);
assert.ok(blankMappedLine.offerTenderLineItem.includes("final vanity/kitchen"));
