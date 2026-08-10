import assert from "node:assert/strict";
import { numberInputValue } from "../../components/offers/new-workflow/offer-workspace-format";
import { parseNonNegativeNumberInput } from "../../lib/offer/workspace-pricing";
import {
  deserializeWorkspace,
  INITIAL_TENDER_GATE,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
} from "../../lib/offer/workspace-model";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";

// A zero must never render as a literal "0" inside a numeric input: the caret
// lands beside it, so typing "400" yields "4000" and any value not ending in
// zero has to be deleted first.
assert.equal(numberInputValue(0), "");
assert.equal(numberInputValue(4000), "4000");
assert.equal(numberInputValue(3999), "3999");
assert.equal(numberInputValue(12.5), "12.5");

// The empty field is only safe because a blank parses back to zero — so
// clearing a field still commits 0 rather than being rejected.
assert.equal(parseNonNegativeNumberInput(""), 0);

// ...and that round-trip is stable: 0 -> "" -> 0, so the field can't flicker
// back to "0" once emptied.
assert.equal(numberInputValue(parseNonNegativeNumberInput("") as number), "");

// Typing into a now-empty field yields exactly what was typed.
assert.equal(numberInputValue(parseNonNegativeNumberInput("4000") as number), "4000");

// ─── Optional price inputs survive the cents round-trip as a blank field ───
// An un-entered price persists as 0 cents; it must rehydrate as "" and not the
// literal "0" that used to sit in the box.
const snapshot: OfferWorkspaceSnapshot = {
  job: INITIAL_OFFER_JOB,
  lines: INITIAL_COST_LINES,
  allowances: INITIAL_ALLOWANCES,
  exclusions: INITIAL_EXCLUSIONS,
  draft: INITIAL_OFFER_DRAFT,
  areaCalculator: INITIAL_AREA_CALCULATOR,
  workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
  paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  rateCardProduct: "SINGLE_STOREY",
  rateCardTier: "STANDARD",
  overrideReason: "",
  selectedPriceInput: "",
  standardPriceInput: "",
  priceAdjustmentLabel: "",
  images: EMPTY_OFFER_IMAGES,
  tenderGate: INITIAL_TENDER_GATE
};

const blankRoundTrip = deserializeWorkspace(serializeWorkspace(snapshot));
assert.equal(blankRoundTrip.selectedPriceInput, "");
assert.equal(blankRoundTrip.standardPriceInput, "");

// A real price still round-trips intact.
const pricedRoundTrip = deserializeWorkspace(
  serializeWorkspace({
    ...snapshot,
    selectedPriceInput: "945000",
    standardPriceInput: "1000000",
  }),
);
assert.equal(pricedRoundTrip.selectedPriceInput, "945000");
assert.equal(pricedRoundTrip.standardPriceInput, "1000000");

console.log("numeric-input tests passed");
