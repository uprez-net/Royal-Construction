import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TenderPanel } from "@/components/offers/new-workflow/offer-workspace-tender";
import {
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferDocumentDraft,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";

// The preview must match the Tender PDF: neither shows allowance amounts.

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

function render(draft: OfferDocumentDraft = INITIAL_OFFER_DRAFT): string {
  return renderToStaticMarkup(
    createElement(TenderPanel, {
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
      onSubjectToSitePricesChange: () => {},
      paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
      signerStatuses: [],
      status: "tender_draft",
      subjectToSitePrices: false,
    }),
  );
}

test("tender preview omits dollar-value allowances", () => {
  const html = render();
  assert.doesNotMatch(
    html,
    /<p[^>]*>Allowances<\/p>|Kitchen appliances|Tiles and bathroom fixtures|\$8,500|\$70\/sqm/,
  );
});

test("an empty inclusions list says where to add them, in readable text", () => {
  const html = render({ ...INITIAL_OFFER_DRAFT, inclusionSchedule: [] });
  const empty = html.match(
    /<p class="([^"]*)">No inclusions captured yet\. Add them in the inclusion schedule on the Offer document step\.<\/p>/,
  );

  assert.ok(empty, "the empty inclusions line should name the step to use");
  assert.doesNotMatch(empty[1], /text-muted-foreground\/\d+/);
});
