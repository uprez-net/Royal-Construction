import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferWorkspacePrintTemplate } from "../../components/offers/new-workflow/offer-workspace-print-template";
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import { INITIAL_TENDER_GATE, type OfferWorkspaceSnapshot } from "../../lib/offer/workspace-persistence";
import {
  EMPTY_OFFER_IMAGES,
  type OfferImageMap,
} from "../../lib/offer/workspace-images";

const SNAPSHOT: OfferWorkspaceSnapshot = {
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
  tenderGate: INITIAL_TENDER_GATE,
  overrideReason: "",
  selectedPriceInput: "",
  standardPriceInput: "",
  priceAdjustmentLabel: "",
  images: EMPTY_OFFER_IMAGES,
};

const proposalInput = buildProposalInput(SNAPSHOT);

function renderReactProposal(images: OfferImageMap): string {
  return renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...proposalInput,
      images,
    }),
  );
}

test("hides image sections when no images are attached", () => {
  // Given
  const images = EMPTY_OFFER_IMAGES;

  // When
  const serverHtml = buildProposalHtml(proposalInput, images);
  const reactHtml = renderReactProposal(images);

  // Then
  for (const html of [serverHtml, reactHtml]) {
    assert.doesNotMatch(html, /Image to be attached/);
    assert.doesNotMatch(html, /Your home will be finished to this standard/);
  }
  assert.doesNotMatch(serverHtml, /<div class="hero">/);
});

test("renders attached images without placeholders for empty slots", () => {
  // Given
  const images: OfferImageMap = {
    exterior: {
      url: "/exterior.jpg",
      source: "upload",
    },
  };

  // When
  const serverHtml = buildProposalHtml(proposalInput, images);
  const reactHtml = renderReactProposal(images);

  // Then
  for (const html of [serverHtml, reactHtml]) {
    assert.match(html, /exterior\.jpg/);
    assert.doesNotMatch(html, /Image to be attached/);
    assert.doesNotMatch(html, /Hero — completed home \/ render/);
    assert.doesNotMatch(html, /Kitchen &amp; butler/);
  }
});
