import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TenderPanel } from "../../components/offers/new-workflow/offer-workspace-tender";
import {
  INITIAL_ALLOWANCES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferDocumentDraft,
  type OfferWorkspaceScopeItem,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import { buildOfferPrintTemplateData } from "../../lib/offer/workspace-print-template";
import type { OfferCustomerPrice } from "../../lib/offer/workspace-pricing";

// The on-screen Tender listed inclusions and exclusions but no allowances, so
// the estimator reviewing it before DocuSign never saw the prime-cost and
// provisional sums the document discloses. Its empty inclusions line also named
// no next step, in muted/80 text that measures 3.70:1.
//
// It reads tenderScopeRows, not scopeRows: those are the allowances ticked
// "Show on Tender". Once #245 split the two boxes and seeded allowances OFF the
// Offer document, reading scopeRows emptied the preview while the Tender PDF
// still listed all three — a preview that contradicted the document it previews.

// Typed, not cast: `as never` made this assignable to any prop, so the fixture
// could omit required fields and the test would still render a shape the
// component can never receive.
const customerPrice: OfferCustomerPrice = {
  computedContractValueIncGst: 850_000,
  selectedContractValueIncGst: 850_000,
  varianceIncGst: 0,
  hasManualOverride: false,
  needsOverrideReason: false,
};

function render(
  allowances: readonly OfferWorkspaceScopeItem[],
  draft: OfferDocumentDraft = INITIAL_OFFER_DRAFT,
): string {
  return renderToStaticMarkup(
    createElement(TenderPanel, {
      allowances,
      customerPrice,
      draft,
      exclusions: INITIAL_EXCLUSIONS,
      job: INITIAL_OFFER_JOB,
      lifecycleBusy: null,
      onGenerateTender: () => {},
      onMarkTenderSigned: () => {},
      onPaymentScheduleChange: () => {},
      onRecallTender: () => {},
      onSendTender: () => {},
      paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
      signerStatuses: [],
      status: "tender_draft",
    }),
  );
}

// The amount wording the printed allowances page uses for the same rows.
function printedAmountLabels(
  allowances: readonly OfferWorkspaceScopeItem[],
): readonly string[] {
  return buildOfferPrintTemplateData({
    allowances,
    customerPrice,
    draft: INITIAL_OFFER_DRAFT,
    exclusions: INITIAL_EXCLUSIONS,
    job: INITIAL_OFFER_JOB,
    lines: [],
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    priceAdjustmentLabel: "",
    standardPriceIncGst: null,
    // tenderScopeRows, like the preview itself: seeded allowances sit OFF the
    // Offer document, so mapping scopeRows returned an empty list and the
    // amount assertions below quietly checked nothing at all.
  }).tenderScopeRows.map((row) => row.amountLabel);
}

test("the tender preview lists every allowance ticked for the Tender", () => {
  const html = render(INITIAL_ALLOWANCES);

  assert.match(html, /Allowances/);
  for (const allowance of INITIAL_ALLOWANCES) {
    assert.ok(html.includes(allowance.label), `missing ${allowance.label}`);
    assert.ok(
      html.includes(allowance.variationRule),
      `missing the variation rule for ${allowance.label}`,
    );
  }
  const amountLabels = printedAmountLabels(INITIAL_ALLOWANCES);
  assert.ok(amountLabels.length > 0, "no amounts to check — the helper read the wrong list");
  for (const amountLabel of amountLabels) {
    assert.ok(html.includes(amountLabel), `missing amount ${amountLabel}`);
  }
});

test("an allowance left off the Tender stays off the tender preview", () => {
  const [shown, hidden] = INITIAL_ALLOWANCES;
  const html = render([shown, { ...hidden, includedInTender: false }]);

  assert.ok(html.includes(shown.label));
  assert.ok(!html.includes(hidden.label));
});

// The preview reads the same list the Tender prints, so an allowance kept off
// the shorter Offer document still has to appear here: that split is exactly
// what the Tender's "Show on Tender" box exists for, and every seeded allowance
// starts off the Offer and on the Tender.
test("an allowance kept off the Offer document is still previewed", () => {
  const [first] = INITIAL_ALLOWANCES;
  const html = render([{ ...first, includedInOfferDocument: false, includedInTender: true }]);

  assert.ok(html.includes(first.label), "the Tender preview dropped a Tender allowance");
});

test("an empty inclusions list says where to add them, in readable text", () => {
  const html = render([], { ...INITIAL_OFFER_DRAFT, inclusionSchedule: [] });
  const empty = html.match(
    /<p class="([^"]*)">No inclusions captured yet\. Add them in the inclusion schedule on the Offer document step\.<\/p>/,
  );

  assert.ok(empty, "the empty inclusions line should name the step to use");
  assert.doesNotMatch(empty[1], /text-muted-foreground\/\d+/);
});
