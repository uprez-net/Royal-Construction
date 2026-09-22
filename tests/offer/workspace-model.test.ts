import assert from "node:assert/strict";
import { test } from "vitest";

import {
  INITIAL_PAYMENT_SCHEDULE,
  getPaymentScheduleTotalPct,
} from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  applyTaskMappingToCostLine,
  getIncludedOfferTenderLineItems,
  updateOfferScopeItems,
} from "@/lib/offer/workspace-model";

test("the default payment schedule adds up to the whole contract", () => {
  assert.equal(getPaymentScheduleTotalPct(INITIAL_PAYMENT_SCHEDULE), 1);
});

test("the default payment schedule's stages, percentages and triggers are pinned", () => {
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
});

test("editing one scope item leaves the originals and its siblings untouched", () => {
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
});

test("a fresh offer keeps the whole cost schedule but starts at $0", () => {
  // No sample figures (see INITIAL_COST_BY_TASK).
  assert.equal(INITIAL_COST_LINES.length, 71);
  assert.equal(
    INITIAL_COST_LINES.filter((line) => line.costExGst > 0).length,
    0,
  );
  assert.ok(INITIAL_COST_LINES.every((line) => line.costExGst === 0));
});

test("the SLAB line carries its sequence tasks and tender wording", () => {
  const slabLine = INITIAL_COST_LINES.find((line) => line.itemName === "SLAB");
  assert.ok(slabLine);
  assert.deepEqual(slabLine.buildingSequenceTasks, [
    "Piering & Pouring",
    "Steel reinforcement",
    "Formwork Check",
    "Slab gets poured",
  ]);
  assert.ok(slabLine.offerTenderLineItem.includes("H1-class structural slab"));
});

test("a fresh $0 offer surfaces no priced line items", () => {
  // Cost-gated: the preview falls back to the standard inclusion bullets until
  // costs are entered.
  assert.deepEqual(getIncludedOfferTenderLineItems(INITIAL_COST_LINES), []);
});

test("mapping a task onto a blank line fills in its name, tasks and wording", () => {
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
  assert.ok(
    blankMappedLine.offerTenderLineItem.includes("final vanity/kitchen"),
  );
});
