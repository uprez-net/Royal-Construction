import assert from "node:assert/strict";
import { test } from "vitest";

import { applyAdminPrefillToSnapshot } from "@/lib/offer/admin-offer-prefill";
import type { AdminOfferPrefill } from "@/lib/offer/admin-offer-prefill";
import { isOfferBuildStepEditable } from "@/lib/offer/offer-editability";
import { collectOfferSendBlockers } from "@/lib/offer/offer-readiness";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  deserializeWorkspace,
  INITIAL_TENDER_GATE,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// Admin offer content is versioned (AdminOfferContent.version) and every offer
// stamps the version it was built from. Opening a STILL-EDITABLE offer whose
// stamp is behind re-applies the current admin defaults; an agreed/sent offer
// keeps its frozen snapshot and only warns.

function costLine(
  id: string,
  overrides: Partial<OfferWorkspaceCostLine> = {},
): OfferWorkspaceCostLine {
  return {
    id,
    stageCode: "A",
    itemName: id,
    buildingSequenceTasks: [],
    offerTenderLineItem: id,
    tradeOrVendor: "",
    notesOrSpec: "",
    costExGst: 0,
    includedInContract: false,
    ...overrides,
  };
}

function scopeItem(id: string, label: string): OfferWorkspaceScopeItem {
  return {
    id,
    category: "exclusion",
    amountType: "included_note",
    label,
    description: "",
    amount: 0,
    unit: "",
    variationRule: "",
    includedInOfferDocument: true,
    includedInTender: true,
  };
}

const BASE_SNAPSHOT: OfferWorkspaceSnapshot = {
  job: INITIAL_OFFER_JOB,
  lines: INITIAL_COST_LINES,
  allowances: INITIAL_ALLOWANCES,
  exclusions: INITIAL_EXCLUSIONS,
  draft: INITIAL_OFFER_DRAFT,
  areaCalculator: INITIAL_AREA_CALCULATOR,
  workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
  paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  rateCardProduct: "DOUBLE_STOREY",
  rateCardTier: "MID",
  overrideReason: "",
  selectedPriceInput: "",
  standardPriceInput: "",
  priceAdjustmentLabel: "",
  images: EMPTY_OFFER_IMAGES,
  tenderGate: INITIAL_TENDER_GATE,
  adminContentVersion: 3,
  extraCosts: INITIAL_EXTRA_COSTS,
  calcVersion: LEGACY_CALC_VERSION,
};

const PREFILL: AdminOfferPrefill = {
  adminVersion: 7,
  loadingChargePercentage: 0,
  buildScope: ["Admin scope line"],
  costLines: [
    // Admin prices this one, so the admin figure wins.
    costLine("task-slab", { costExGst: 42_000, includedInContract: true }),
    // Admin does not price this one (priceMode "none"/formula → 0).
    costLine("task-landscaping"),
    // A task the admin has just added.
    costLine("task-solar"),
  ],
  allowances: [scopeItem("admin-allowance-1", "Tiling allowance")],
  exclusions: [scopeItem("admin-exclusion-1", "Pool")],
  draft: { ...INITIAL_OFFER_DRAFT, headline: "New admin headline" },
  areaCalculator: INITIAL_AREA_CALCULATOR,
  rateConstants: {},
};

test("re-applying admin defaults restamps the admin version", () => {
  const next = applyAdminPrefillToSnapshot(BASE_SNAPSHOT, PREFILL);

  assert.equal(next.adminContentVersion, 7);
});

test("the admin lists decide which allowances and exclusions exist", () => {
  const next = applyAdminPrefillToSnapshot(BASE_SNAPSHOT, PREFILL);

  // The base offer carries the built-in defaults, which the admin lists stand
  // in for, so they are replaced and not kept beside their admin twins.
  assert.deepEqual(next.allowances, PREFILL.allowances);
  assert.deepEqual(next.exclusions, PREFILL.exclusions);
});

test("an estimator's edits to an admin allowance or exclusion survive a re-apply (#328)", () => {
  const snapshot = {
    ...BASE_SNAPSHOT,
    allowances: [
      {
        ...scopeItem("admin-allowance-1-tiling", "Tiling allowance"),
        includedInOfferDocument: true,
      },
    ],
    exclusions: [
      scopeItem("admin-exclusion-1-pool", "Boundary or pool fencing"),
    ],
  };
  const prefill = {
    ...PREFILL,
    allowances: [
      {
        ...scopeItem("admin-allowance-1-tiling", "Tiling allowance"),
        includedInOfferDocument: false,
      },
    ],
    exclusions: [
      scopeItem("admin-exclusion-1-pool", "Landscaping and fencing"),
    ],
  };

  const next = applyAdminPrefillToSnapshot(snapshot, prefill);

  // The tick that puts the allowance on the customer's offer document.
  assert.equal(next.allowances[0].includedInOfferDocument, true);
  assert.equal(next.exclusions[0].label, "Boundary or pool fencing");
});

test("an exclusion the estimator or Eve added is kept", () => {
  const snapshot = {
    ...BASE_SNAPSHOT,
    exclusions: [
      scopeItem("admin-exclusion-1-pool", "Pool"),
      scopeItem("exclusion-manual-1", "Letterbox and house numbering"),
    ],
  };

  const next = applyAdminPrefillToSnapshot(snapshot, PREFILL);

  assert.deepEqual(
    next.exclusions.map((item) => item.label),
    ["Pool", "Letterbox and house numbering"],
  );
});

test("an exclusion Eve added with a numeric id is kept; only the built-in defaults are replaced", () => {
  // Eve accepts any id string. `exclusion-3` is not one of the built-in rows
  // (`exclusion-1`, `exclusion-2`), so it is the office's and must survive.
  const snapshot = {
    ...BASE_SNAPSHOT,
    exclusions: [
      scopeItem("exclusion-1", "Built-in default"),
      scopeItem("exclusion-3", "Added by Eve"),
    ],
  };

  const next = applyAdminPrefillToSnapshot(snapshot, PREFILL);

  assert.deepEqual(
    next.exclusions.map((item) => item.label),
    ["Pool", "Added by Eve"],
  );
});

test("an admin item inserted above the others does not duplicate or drop the rest", () => {
  // The position inside the id shifts when the admin inserts a row; the admin
  // id after it is what names the item.
  const snapshot = {
    ...BASE_SNAPSHOT,
    exclusions: [
      { ...scopeItem("admin-exclusion-1-pool", "Pool"), description: "edited" },
    ],
  };
  const prefill = {
    ...PREFILL,
    exclusions: [
      scopeItem("admin-exclusion-1-solar", "Solar"),
      scopeItem("admin-exclusion-2-pool", "Pool"),
    ],
  };

  const next = applyAdminPrefillToSnapshot(snapshot, prefill);

  assert.deepEqual(
    next.exclusions.map((item) => [item.label, item.description]),
    [
      ["Solar", ""],
      ["Pool", "edited"],
    ],
  );
});

test("an admin item the admin has removed is dropped from the offer", () => {
  const snapshot = {
    ...BASE_SNAPSHOT,
    exclusions: [
      scopeItem("admin-exclusion-1-pool", "Pool"),
      scopeItem("admin-exclusion-2-retired", "Retired"),
    ],
  };

  const next = applyAdminPrefillToSnapshot(snapshot, PREFILL);

  assert.deepEqual(
    next.exclusions.map((item) => item.label),
    ["Pool"],
  );
});

test("the estimator's document draft is not replaced, so a negotiated deposit schedule survives (#328)", () => {
  const snapshot = {
    ...BASE_SNAPSHOT,
    draft: {
      ...INITIAL_OFFER_DRAFT,
      termsSummary: "Deposit: $5,000 payable now",
      exclusionBullets: ["Boundary or pool fencing"],
    },
  };

  const next = applyAdminPrefillToSnapshot(snapshot, PREFILL);

  assert.equal(next.draft.termsSummary, "Deposit: $5,000 payable now");
  assert.deepEqual(next.draft.exclusionBullets, ["Boundary or pool fencing"]);
  assert.equal(next.adminContentVersion, 7);
});

test("the admin cost-line set replaces the offer's, so added and removed tasks propagate", () => {
  const snapshot = {
    ...BASE_SNAPSHOT,
    lines: [costLine("task-slab"), costLine("task-retired-task")],
  };

  const next = applyAdminPrefillToSnapshot(snapshot, PREFILL);

  assert.deepEqual(
    next.lines.map((line) => line.id),
    ["task-slab", "task-landscaping", "task-solar"],
  );
});

test("an admin-priced line takes the admin figure over the offer's", () => {
  const snapshot = {
    ...BASE_SNAPSHOT,
    lines: [costLine("task-slab", { costExGst: 1_000 })],
  };

  const next = applyAdminPrefillToSnapshot(snapshot, PREFILL);
  const slab = next.lines.find((line) => line.id === "task-slab");

  assert.equal(slab?.costExGst, 42_000);
  assert.equal(slab?.includedInContract, true);
});

test("an estimator's figure on a line the admin does not price is preserved", () => {
  // task-landscaping arrives from admin at 0 — that is "no admin default", not
  // "the price is zero", so the estimator's entered cost must survive.
  const snapshot = {
    ...BASE_SNAPSHOT,
    lines: [
      costLine("task-landscaping", {
        costExGst: 8_500,
        includedInContract: true,
      }),
    ],
  };

  const next = applyAdminPrefillToSnapshot(snapshot, PREFILL);
  const landscaping = next.lines.find((line) => line.id === "task-landscaping");

  assert.equal(landscaping?.costExGst, 8_500);
  assert.equal(landscaping?.includedInContract, true);
});

test("project-specific state is never touched by a re-apply", () => {
  const snapshot = {
    ...BASE_SNAPSHOT,
    job: {
      ...INITIAL_OFFER_JOB,
      siteAddress: "12 Example St",
      groundFloorSqm: 180,
    },
    selectedPriceInput: "512000",
    priceAdjustmentLabel: "Launch saving",
  };

  const next = applyAdminPrefillToSnapshot(snapshot, PREFILL);

  assert.equal(next.job.siteAddress, "12 Example St");
  assert.equal(next.job.groundFloorSqm, 180);
  assert.equal(next.selectedPriceInput, "512000");
  assert.equal(next.priceAdjustmentLabel, "Launch saving");
  assert.deepEqual(next.paymentSchedule, snapshot.paymentSchedule);
  assert.deepEqual(next.tenderGate, snapshot.tenderGate);
});

test("only a pending offer is re-applied to; sent and agreed stay frozen", () => {
  // The loader asks the cost-schedule step, so this is the same rule the
  // workspace locks the price inputs with.
  assert.equal(isOfferBuildStepEditable("cost-schedule", "pending"), true);
  assert.equal(isOfferBuildStepEditable("cost-schedule", "sent"), false);
  assert.equal(isOfferBuildStepEditable("cost-schedule", "agreed"), false);
});

test("a frozen offer whose admin content moved on warns rather than blocks", () => {
  const blockers = collectOfferSendBlockers({
    hasKnownFloorArea: true,
    hasLead: true,
    needsOverrideReason: false,
    expiryState: "valid",
    adminContentStale: true,
  });
  const stale = blockers.find(
    (blocker) => blocker.id === "admin-content-stale",
  );

  assert.ok(stale, "expected a stale-admin-content blocker");
  assert.equal(stale?.severity, "warn");
});

test("no stale blocker when admin content is current", () => {
  const blockers = collectOfferSendBlockers({
    hasKnownFloorArea: true,
    hasLead: true,
    needsOverrideReason: false,
    expiryState: "valid",
  });

  assert.equal(
    blockers.some((blocker) => blocker.id === "admin-content-stale"),
    false,
  );
});

test("the admin version survives a persistence round-trip", () => {
  const snapshot = { ...BASE_SNAPSHOT, adminContentVersion: 12 };

  const restored = deserializeWorkspace(
    parseWorkspaceState(serializeWorkspace(snapshot)),
  );

  assert.equal(restored.adminContentVersion, 12);
});

test("an offer persisted before versioning parses as version 0, so it reads as stale", () => {
  const persisted = serializeWorkspace(BASE_SNAPSHOT) as Record<
    string,
    unknown
  >;
  delete persisted.adminContentVersion;

  const restored = deserializeWorkspace(parseWorkspaceState(persisted));

  assert.equal(restored.adminContentVersion, 0);
  assert.notEqual(restored.adminContentVersion, PREFILL.adminVersion);
});
