import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferWorkspacePrintTemplate } from "../../components/offers/new-workflow/offer-workspace-print-template";
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
  createCompanyOwner,
  createIndividualOwner,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  MAX_OWNER_SIGNERS,
  type OfferOwner,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import type { OfferWorkspaceSnapshot } from "../../lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";

function snapshotWithOwners(owners: OfferOwner[]): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB, owners },
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
  };
}

function individualOwner(index: number): OfferOwner {
  const base = createIndividualOwner(`owner-${index}`);
  return {
    ...base,
    displayName: `Owner ${index}`,
    currentLocation: `${index} Test St, Sydney NSW 2000`,
    signatories: [
      {
        ...base.signatories[0],
        name: `Owner ${index}`,
        email: `owner${index}@example.com`,
      },
    ],
  };
}

function proposalHtmlFor(owners: OfferOwner[]): string {
  return buildProposalHtml(
    buildProposalInput(snapshotWithOwners(owners)),
    EMPTY_OFFER_IMAGES,
  );
}

// The separate React path behind the browser's "Download Offer" (window.print()).
function reactPrintHtmlFor(owners: OfferOwner[]): string {
  return renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...buildProposalInput(snapshotWithOwners(owners)),
      images: EMPTY_OFFER_IMAGES,
    }),
  );
}

function physicalPageCount(html: string): number {
  return (html.match(/<div class="page">/g) ?? []).length;
}

// Each React PrintPage is a <section> sized to a full A4 sheet.
function reactPageCount(html: string): number {
  return (html.match(/min-h-\[297mm\]/g) ?? []).length;
}

// Every "… | Page X of M" footer must agree on M, and the last X must equal M.
function footerPaging(html: string): { lastPage: number; total: number } {
  const matches = [...html.matchAll(/Page (\d+) of (\d+)/g)];
  assert.ok(matches.length > 0, "expected numbered page footers");
  const totals = new Set(matches.map((m) => Number(m[2])));
  assert.equal(
    totals.size,
    1,
    `all footers must declare one total, saw ${JSON.stringify([...totals])}`,
  );
  const pageNumbers = matches.map((m) => Number(m[1]));
  return { lastPage: Math.max(...pageNumbers), total: [...totals][0] };
}

test("the max-signer proposal foots the true physical page count (PR #124)", () => {
  const owners = Array.from({ length: MAX_OWNER_SIGNERS }, (_, i) =>
    individualOwner(i + 1),
  );
  const html = proposalHtmlFor(owners);

  const pages = physicalPageCount(html);
  const { lastPage, total } = footerPaging(html);
  // The old bug: 10 signature blocks overflowed one fixed-height page, so there
  // were 10 physical pages while the footer read "Page 9 of 9". Physical pages
  // must equal the declared total, and the last footer must equal that total.
  assert.equal(
    pages,
    total,
    `physical pages (${pages}) must equal the footer total (${total})`,
  );
  assert.equal(lastPage, total, "last footer number must equal the total");

  // Signatures are paginated onto their own page(s), and no owner is dropped.
  assert.match(html, /Acceptance &amp; signatures/);
  for (let i = 1; i <= MAX_OWNER_SIGNERS; i++) {
    assert.ok(html.includes(`Owner ${i}`), `owner ${i} missing from the proposal`);
  }
});

test("the React print path also foots its true page count at max signers (PR #124)", () => {
  const owners = Array.from({ length: MAX_OWNER_SIGNERS }, (_, i) =>
    individualOwner(i + 1),
  );
  const html = reactPrintHtmlFor(owners);

  // The browser "Download Offer" template is a SEPARATE renderer from the emailed
  // HTML; it kept every signature block under the payment table on one nominal A4
  // page, so 10 signers spilled into extra physical pages the footer never counted.
  const pages = reactPageCount(html);
  const { lastPage, total } = footerPaging(html);
  assert.equal(
    pages,
    total,
    `React print pages (${pages}) must equal the footer total (${total})`,
  );
  assert.equal(lastPage, total, "last footer number must equal the total");

  assert.match(html, /Acceptance &amp; signatures/);
  for (let i = 1; i <= MAX_OWNER_SIGNERS; i++) {
    assert.ok(html.includes(`Owner ${i}`), `owner ${i} missing from the print view`);
  }
});

test("the React print path keeps a single signer inline", () => {
  const html = reactPrintHtmlFor([individualOwner(1)]);
  const pages = reactPageCount(html);
  const { lastPage, total } = footerPaging(html);
  assert.equal(pages, total);
  assert.equal(lastPage, total);
  assert.doesNotMatch(html, /Acceptance &amp; signatures/);
});

test("the emailed and printed documents agree on page count (PR #124)", () => {
  // Both renderers must paginate identically — otherwise the PDF the client
  // receives and the copy the estimator downloads disagree.
  const owners = Array.from({ length: MAX_OWNER_SIGNERS }, (_, i) =>
    individualOwner(i + 1),
  );
  assert.equal(
    footerPaging(reactPrintHtmlFor(owners)).total,
    footerPaging(proposalHtmlFor(owners)).total,
  );
});

test("company names with '&' are single-escaped in the acceptance line (PR #124)", () => {
  const base = createCompanyOwner("c1");
  const owner: OfferOwner = {
    ...base,
    displayName: "Smith & Jones Holdings Pty Ltd",
    abn: "12 345 678 901",
    currentLocation: "1 Test St, Sydney NSW 2000",
    signatories: [
      {
        ...base.signatories[0],
        name: "Pat Smith",
        email: "pat@example.com",
      },
    ],
  };
  const html = proposalHtmlFor([owner]);
  // The legal acceptance paragraph must escape the "&" exactly once — the old
  // esc(esc(...)) double-escape rendered "Smith &amp;amp; Jones" literally.
  assert.match(html, /I\/We, Smith &amp; Jones Holdings Pty Ltd, accept/);
  assert.doesNotMatch(html, /&amp;amp;/);
});

test("a single-signer proposal keeps signatures inline, footer consistent", () => {
  const html = proposalHtmlFor([individualOwner(1)]);
  const pages = physicalPageCount(html);
  const { lastPage, total } = footerPaging(html);
  assert.equal(pages, total);
  assert.equal(lastPage, total);
  // Few signers fit under the terms-page payment table — no dedicated sig page.
  assert.doesNotMatch(html, /Acceptance &amp; signatures/);
});
