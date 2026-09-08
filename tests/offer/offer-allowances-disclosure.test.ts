import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferWorkspacePrintTemplate } from "../../components/offers/new-workflow/offer-workspace-print-template";
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { buildOfferPrintTemplateData } from "../../lib/offer/workspace-print-template";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferWorkspaceScopeItem,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";

// buildOfferPrintTemplateData has always computed `scopeRows` from the
// allowances the estimator ticks "Show on Offer document" on the Scope step, and
// until now no renderer consumed them. A fixed-price proposal went out with no
// statement of which sums were prime-cost or provisional, what they were worth,
// or what happens when the real cost differs — while the estimator saw a ticked
// checkbox saying it would.
//
// Both renderers of the offer document now disclose them, on their own page, and
// only when there is something to disclose.

function snapshotWith(
  allowances: readonly OfferWorkspaceScopeItem[],
): OfferWorkspaceSnapshot {
  return {
    job: INITIAL_OFFER_JOB,
    lines: INITIAL_COST_LINES,
    allowances,
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

const shown = INITIAL_ALLOWANCES.filter((item) => item.includedInOfferDocument);
const hidden = INITIAL_ALLOWANCES.map((item) => ({
  ...item,
  includedInOfferDocument: false,
}));

function reactMarkup(snapshot: OfferWorkspaceSnapshot): string {
  return renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...buildProposalInput(snapshot),
      images: EMPTY_OFFER_IMAGES,
    }),
  );
}

function declaredPageTotal(html: string): number {
  const match = html.match(/Page \d+ of (\d+)/);
  assert.ok(match, "document declares no page total");
  return Number(match[1]);
}

test("the fixture actually has allowances to disclose", () => {
  // Guards every assertion below: if the defaults ever stop ticking
  // includedInOfferDocument, these tests would pass vacuously.
  assert.ok(shown.length > 0, "no default allowance is shown on the offer");
});

test("scopeRows still carries the ticked allowances", () => {
  const data = buildOfferPrintTemplateData(buildProposalInput(snapshotWith(INITIAL_ALLOWANCES)));
  assert.equal(data.scopeRows.length, shown.length);
  assert.deepEqual(
    data.scopeRows.map((row) => row.label),
    shown.map((item) => item.label),
  );
});

test("unticked allowances never reach scopeRows", () => {
  const data = buildOfferPrintTemplateData(buildProposalInput(snapshotWith(hidden)));
  assert.equal(data.scopeRows.length, 0);
});

test("the printed offer discloses every ticked allowance", () => {
  const html = reactMarkup(snapshotWith(INITIAL_ALLOWANCES));
  assert.match(html, /Prime cost &amp; provisional sums/);
  for (const item of shown) {
    assert.ok(
      html.includes(item.label),
      `the printed offer never names the allowance "${item.label}"`,
    );
  }
});

test("the emailed offer discloses every ticked allowance", () => {
  const html = buildProposalHtml(
    buildProposalInput(snapshotWith(INITIAL_ALLOWANCES)),
    EMPTY_OFFER_IMAGES,
  );
  assert.match(html, /Prime cost &amp; provisional sums/);
  for (const item of shown) {
    assert.ok(
      html.includes(item.label),
      `the emailed offer never names the allowance "${item.label}"`,
    );
  }
});

test("the disclosure states the variation rule, not just the amount", () => {
  // An allowance without its variation rule is the part that causes the dispute:
  // the customer needs to know what happens when the real cost differs.
  const html = reactMarkup(snapshotWith(INITIAL_ALLOWANCES));
  assert.match(html, /adjusted by written variation/);
});

test("an allowance whose description repeats its variation rule prints it once", () => {
  // Found by rendering real staging offers: 72% of live allowance rows carry the
  // SAME sentence in description and variationRule, and the seeded fixtures do
  // not. A four-column table printed it twice side by side on the customer's
  // proposal. The duplicate is dropped in the shared template data so the
  // printed and emailed documents cannot diverge on it.
  const repeated = "Selections above the allowance become a variation.";
  const items = [
    {
      ...INITIAL_ALLOWANCES[0],
      description: repeated,
      variationRule: repeated,
      includedInOfferDocument: true,
    },
  ];
  const data = buildOfferPrintTemplateData(buildProposalInput(snapshotWith(items)));
  assert.equal(data.scopeRows[0].description, "");
  assert.equal(data.scopeRows[0].variationRule, repeated);

  const html = reactMarkup(snapshotWith(items));
  const body = html.slice(html.indexOf("Prime cost"));
  const occurrences = body.split(repeated).length - 1;
  assert.equal(occurrences, 1, `the same sentence printed ${occurrences} times in one row`);
});

test("a genuinely distinct description is still printed", () => {
  const data = buildOfferPrintTemplateData(
    buildProposalInput(snapshotWith(INITIAL_ALLOWANCES)),
  );
  const withDescription = data.scopeRows.find((row) => row.description !== "");
  assert.ok(withDescription, "the dedupe swallowed every description");
  assert.ok(
    reactMarkup(snapshotWith(INITIAL_ALLOWANCES)).includes(
      withDescription.description,
    ),
  );
});

test("an offer with no ticked allowances adds no page to either renderer", () => {
  // Offers that disclose nothing must keep exactly the document they had before.
  const withNone = reactMarkup(snapshotWith(hidden));
  assert.equal(withNone.includes("Prime cost &amp; provisional sums"), false);

  const emailedNone = buildProposalHtml(
    buildProposalInput(snapshotWith(hidden)),
    EMPTY_OFFER_IMAGES,
  );
  const emailedSome = buildProposalHtml(
    buildProposalInput(snapshotWith(INITIAL_ALLOWANCES)),
    EMPTY_OFFER_IMAGES,
  );
  assert.equal(
    declaredPageTotal(emailedSome) - declaredPageTotal(emailedNone),
    1,
    "the allowances page is not counted in the emailed document's page total",
  );
});

test("both renderers agree on the page count with allowances present", () => {
  // The three renderers have drifted before, which is why the template data is
  // derived once and shared. A page added to one and not the other is that same
  // failure, and the footers are where it shows.
  const snapshot = snapshotWith(INITIAL_ALLOWANCES);
  assert.equal(
    declaredPageTotal(reactMarkup(snapshot)),
    declaredPageTotal(
      buildProposalHtml(buildProposalInput(snapshot), EMPTY_OFFER_IMAGES),
    ),
  );
});
