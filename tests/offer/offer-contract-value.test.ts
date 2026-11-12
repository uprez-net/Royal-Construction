import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveOfferContractValue } from "@/lib/offer/offer-contract-value";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import {
  INITIAL_TENDER_GATE,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { calculateOfferWorkspacePricing } from "@/lib/offer/workspace-pricing";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferWorkspaceCostLine,
} from "@/lib/offer/workspace-model";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// Backs the Versions timeline's price column. Offer.contractValueIncGst used to
// be written from the OPTIONAL price override, which is 0 whenever the estimator
// priced the offer the normal way — so every such revision was stored as $0 and
// the history claimed the client had been quoted nothing. Rows saved before that
// fix are still wrong in the database, so the price is repaired on read from the
// revision's own snapshot.

const DIRECT_TOTAL = 400000;
const COST_LINE: OfferWorkspaceCostLine = {
  id: "line-1",
  stageCode: "A",
  itemName: "Base build",
  buildingSequenceTasks: [],
  offerTenderLineItem: "",
  tradeOrVendor: "",
  notesOrSpec: "",
  costExGst: DIRECT_TOTAL,
  includedInContract: true,
};

const COMPUTED_CONTRACT_INC_GST = calculateOfferWorkspacePricing({
  directTotal: DIRECT_TOTAL,
  totalAreaSqm: 0,
  settings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
}).contractValueIncGst;

function makeSnapshot(
  overrides: Partial<OfferWorkspaceSnapshot> = {},
): OfferWorkspaceSnapshot {
  return {
    job: INITIAL_OFFER_JOB,
    lines: [COST_LINE],
    allowances: [],
    exclusions: [],
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
    adminContentVersion: 0,
    extraCosts: INITIAL_EXTRA_COSTS,
    calcVersion: LEGACY_CALC_VERSION,
    ...overrides,
  };
}

// The row as Prisma hands it back: workspaceState is plain JSON, not a snapshot.
function storedState(snapshot: OfferWorkspaceSnapshot): unknown {
  return JSON.parse(JSON.stringify(serializeWorkspace(snapshot)));
}

// Sanity: the baseline this suite asserts against is a real, positive price.
assert.ok(COMPUTED_CONTRACT_INC_GST > 0);

test("REGRESSION: a revision stored as $0 reports the price the client was actually quoted", () => {
  // Given a revision priced the normal way (no manual override), whose column
  // was written by the old code from the blank override — i.e. 0
  const state = storedState(makeSnapshot());

  // When the Versions timeline resolves its price
  const value = resolveOfferContractValue(0, state);

  // Then it reports the computed contract value, not the stored $0
  assert.equal(value, COMPUTED_CONTRACT_INC_GST);
});

test("a positive stored value is authoritative and is never recomputed", () => {
  // Given a revision whose saved column disagrees with what its snapshot would
  // price today — a sent revision must keep the number the client received
  const state = storedState(makeSnapshot());

  // When
  const value = resolveOfferContractValue(123456, state);

  // Then the stored figure wins
  assert.equal(value, 123456);
  assert.notEqual(value, COMPUTED_CONTRACT_INC_GST);
});

test("a manual override is carried through the derivation", () => {
  // Given a revision the estimator capped at $600k
  const state = storedState(
    makeSnapshot({
      selectedPriceInput: "600000",
      overrideReason: "Client cap",
    }),
  );

  // When the stored column is the old blank-override $0
  const value = resolveOfferContractValue(0, state);

  // Then the override — not the computed price — is what the history shows
  assert.equal(value, 600000);
});

test("an unpriced revision reports null so the UI renders a dash, not a $0 quote", () => {
  // Given a brand-new revision with nothing saved against it
  // When
  const value = resolveOfferContractValue(null, null);

  // Then null — a real home-build contract is never $0, so a confident "$0"
  // would be a fabricated quote
  assert.equal(value, null);
});

test("a costed-at-zero workspace still reports the price its own document prints", () => {
  // Given a saved workspace with no cost lines. It does not price at $0 — a
  // fixed addition (HBCF) still flows through the markup and GST — so the
  // timeline must show that figure rather than suppress it as "not priced".
  const snapshot = makeSnapshot({
    lines: [],
    workspacePricingSettings: {
      ...DEFAULT_WORKSPACE_PRICING_SETTINGS,
      homeWarrantyHbcfFixed: 8500,
    },
  });
  const state = storedState(snapshot);

  // When
  const value = resolveOfferContractValue(0, state);

  // Then it matches the document exactly, whatever that figure happens to be
  assert.equal(
    value,
    buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst,
  );
});

test("a workspaceState from a retired schema does not take the timeline down", () => {
  // Given a row whose JSON no longer satisfies the current schema
  // When
  const value = resolveOfferContractValue(0, { schemaVersion: 99, junk: true });

  // Then the derivation degrades to "unknown" instead of throwing
  assert.equal(value, null);
});

test("the derived value matches what the client-facing document prints", () => {
  // Given any revision
  const snapshot = makeSnapshot();
  const state = storedState(snapshot);

  // When the timeline derives its price and the proposal renders its price
  const listed = resolveOfferContractValue(0, state);
  const printed =
    buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst;

  // Then they agree — the whole point of the fix is that the history cannot
  // disagree with the document the client holds
  assert.equal(listed, printed);
});
