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

const updatedAllowances = updateOfferScopeItems(INITIAL_ALLOWANCES, "allowance-1", {
  amount: 9500,
});

assert.equal(updatedAllowances[0]?.amount, 9500);
assert.equal(INITIAL_ALLOWANCES[0]?.amount, 8500);
assert.equal(updatedAllowances[1], INITIAL_ALLOWANCES[1]);

assert.equal(INITIAL_COST_LINES.length, 74);
assert.deepEqual(
  INITIAL_COST_LINES.filter((line) => line.costExGst > 0).map((line) => ({
    itemName: line.itemName,
    costExGst: line.costExGst,
    includedInContract: line.includedInContract,
  })),
  [
    {
      itemName: "GENERAL REQUIREMENTS",
      costExGst: 28500,
      includedInContract: true,
    },
    {
      itemName: "SLAB",
      costExGst: 84500,
      includedInContract: true,
    },
    {
      itemName: "FRAME",
      costExGst: 132000,
      includedInContract: true,
    },
    {
      itemName: "KITCHEN",
      costExGst: 76000,
      includedInContract: true,
    },
  ],
);

const slabLine = INITIAL_COST_LINES.find((line) => line.itemName === "SLAB");
assert.ok(slabLine);
assert.deepEqual(slabLine.buildingSequenceTasks, [
  "Piering & Pouring",
  "Steel reinforcement",
  "Formwork Check",
  "Slab gets poured",
]);
assert.ok(slabLine.offerTenderLineItem.includes("H1-class structural slab"));

assert.deepEqual(getIncludedOfferTenderLineItems(INITIAL_COST_LINES), [
  "Comprehensive on-site project management, dedicated builder supervision, and HBCF home warranty insurance.",
  "Excavation, structural piering, perimeter timber formwork, steel reinforcement mesh laying, concrete pump hire, and pouring of H1-class structural slab.",
  "Prefabricated timber structural wall frames, floor joists system (double-story), structural roof trusses, cavity sliding frames, vanity timber wall framing support, and FC eaves linings.",
  "Custom kitchen and Butler's pantry joinery, cabinetry design, measurement, and final cupboard installation.",
]);

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
assert.ok(blankMappedLine.buildingSequenceTasks.includes("Stormwater plumbing"));
assert.ok(blankMappedLine.offerTenderLineItem.includes("final vanity/kitchen"));
