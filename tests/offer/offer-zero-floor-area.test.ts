import assert from "node:assert/strict";
import { test } from "node:test";

import { collectOfferSendBlockers } from "../../lib/offer/offer-readiness";
import { buildWelcomeParagraphs } from "../../lib/offer/workspace-proposal-content";
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { INITIAL_OFFER_JOB } from "../../lib/offer/workspace-model";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import { LEGACY_CALC_VERSION } from "../../lib/offer/workspace-persistence";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";

function zeroAreaSnapshot(): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB },
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: INITIAL_OFFER_DRAFT,
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: 0,
    calcVersion: LEGACY_CALC_VERSION,
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
  };
}

test("send readiness blocks when no floor area is entered", () => {
  const blockers = collectOfferSendBlockers({
    hasLead: true,
    hasKnownFloorArea: false,
    needsOverrideReason: false,
    expiryState: "valid",
  });
  assert.ok(
    blockers.some((b) => b.id === "floor-area" && b.severity === "block"),
  );
});

test("a zero-area proposal does not tell the client their home is 0 m²", () => {
  const html = buildProposalHtml(
    buildProposalInput(zeroAreaSnapshot()),
    EMPTY_OFFER_IMAGES,
  );
  assert.doesNotMatch(html, /0 m²/);
  assert.doesNotMatch(html, /0 square metres/);
  assert.ok(
    buildWelcomeParagraphs(INITIAL_OFFER_JOB).every(
      (p) => !p.includes("0 square metres"),
    ),
  );
});
