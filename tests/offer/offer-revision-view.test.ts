import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferWorkspacePrintTemplate } from "../../components/offers/new-workflow/offer-workspace-print-template";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import {
  buildOfferPrintTemplateData,
  formatDateDisplay,
} from "../../lib/offer/workspace-print-template";
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
import {
  deserializeWorkspace,
  INITIAL_TENDER_GATE,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";

// Backs the read-only revision viewer: a superseded revision is re-rendered
// from its stored snapshot, so the render must reproduce that revision rather
// than pick up today's date or collide with the live document when printing.

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
  overrideReason: "",
  selectedPriceInput: "",
  standardPriceInput: "",
  priceAdjustmentLabel: "",
  images: EMPTY_OFFER_IMAGES,
  tenderGate: INITIAL_TENDER_GATE,
  adminContentVersion: 0,
  calcVersion: LEGACY_CALC_VERSION,
};

const proposalInput = buildProposalInput(SNAPSHOT);

test("stamps the supplied prepared date instead of today", () => {
  // Given a revision drawn up well in the past
  const preparedDate = new Date(2024, 2, 17);

  // When
  const data = buildOfferPrintTemplateData({ ...proposalInput, preparedDate });

  // Then the document carries that date, not the date it was viewed
  assert.equal(data.preparedDateLabel, "17/03/2024");
});

test("a re-sent revision prints the date of its latest send", () => {
  // The viewer dated every re-render by when the revision was created, so a
  // revision emailed again weeks later printed a date the customer never saw.
  // It now passes the latest send; that date is what the document must carry.
  const createdAt = new Date(2026, 5, 2);
  const lastSentAt = new Date(2026, 6, 21, 15, 40);

  const data = buildOfferPrintTemplateData({
    ...proposalInput,
    preparedDate: lastSentAt,
  });

  assert.equal(data.preparedDateLabel, formatDateDisplay(lastSentAt));
  assert.notEqual(data.preparedDateLabel, formatDateDisplay(createdAt));
});

test("falls back to today when no prepared date is supplied", () => {
  // Given the live draft, which passes no preparedDate

  // When
  const data = buildOfferPrintTemplateData(proposalInput);

  // Then
  const today = new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  assert.equal(data.preparedDateLabel, today);
});

test("screen render is excluded from printing, print render is not", () => {
  // Given the same proposal rendered for each surface
  // When
  const screenHtml = renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...proposalInput,
      images: EMPTY_OFFER_IMAGES,
      screen: true,
    }),
  );
  const printHtml = renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...proposalInput,
      images: EMPTY_OFFER_IMAGES,
    }),
  );

  // Then only the print render carries the attribute that globals.css unwraps
  // and force-displays when printing — otherwise an open viewer would print on
  // top of the live offer.
  assert.ok(!screenHtml.includes('data-offer-print-template="true"'));
  assert.ok(screenHtml.includes('data-offer-print-template="screen"'));
  assert.ok(screenHtml.includes("print:hidden"));

  assert.ok(printHtml.includes('data-offer-print-template="true"'));
  assert.ok(printHtml.includes("print:block"));
});

test("a stored snapshot round-trips to the same prices the workspace showed", () => {
  // Given a snapshot persisted and read back exactly as the viewer loads it
  const restored = deserializeWorkspace(
    parseWorkspaceState(
      JSON.parse(JSON.stringify(serializeWorkspace(SNAPSHOT))),
    ),
  );

  // When
  const restoredInput = buildProposalInput(restored);

  // Then the viewer cannot drift from the live workspace's derivation
  assert.deepEqual(restoredInput.customerPrice, proposalInput.customerPrice);
  assert.equal(
    restoredInput.standardPriceIncGst,
    proposalInput.standardPriceIncGst,
  );
});
