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

// The on-screen Tender listed inclusions and exclusions but no allowances, so
// the estimator reviewing it before DocuSign never saw the prime-cost and
// provisional sums ticked for the documents. Its empty inclusions line also
// named no next step, in muted/80 text that measures 3.70:1.

const customerPrice = {
  selectedContractValueIncGst: 850_000,
  hasManualOverride: false,
} as never;

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
  }).scopeRows.map((row) => row.amountLabel);
}

test("the tender preview lists every allowance ticked for the documents", () => {
  const html = render(INITIAL_ALLOWANCES);

  assert.match(html, /Allowances/);
  for (const allowance of INITIAL_ALLOWANCES) {
    assert.ok(html.includes(allowance.label), `missing ${allowance.label}`);
    assert.ok(
      html.includes(allowance.variationRule),
      `missing the variation rule for ${allowance.label}`,
    );
  }
  for (const amountLabel of printedAmountLabels(INITIAL_ALLOWANCES)) {
    assert.ok(html.includes(amountLabel), `missing amount ${amountLabel}`);
  }
});

test("an allowance left off the documents stays off the tender preview", () => {
  const [shown, hidden] = INITIAL_ALLOWANCES;
  const html = render([shown, { ...hidden, includedInOfferDocument: false }]);

  assert.ok(html.includes(shown.label));
  assert.ok(!html.includes(hidden.label));
});

test("an empty inclusions list says where to add them, in readable text", () => {
  const html = render([], { ...INITIAL_OFFER_DRAFT, inclusionSchedule: [] });
  const empty = html.match(
    /<p class="([^"]*)">No inclusions captured yet\. Add them in the inclusion schedule on the Offer document step\.<\/p>/,
  );

  assert.ok(empty, "the empty inclusions line should name the step to use");
  assert.doesNotMatch(empty[1], /text-muted-foreground\/\d+/);
});
