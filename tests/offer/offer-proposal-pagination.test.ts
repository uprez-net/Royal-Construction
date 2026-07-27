import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferWorkspacePrintTemplate } from "../../components/offers/new-workflow/offer-workspace-print-template";
import { buildContractSignatureAnnexureHtml } from "../../lib/offer/contract-annexure-html";
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildTenderHtml } from "../../lib/offer/offer-tender-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
  createCompanyOwner,
  createIndividualOwner,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  formatOwnerGreetingNames,
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

// Counts declared page elements (each React PrintPage is a full-A4 <section>).
// This is a STRUCTURAL count, not a rendered-page count.
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

// NOTE ON WHAT THIS FILE PROVES: these assertions inspect the DECLARED document
// structure (emitted page elements, footer totals, which blocks land where). They
// cannot see content overflowing its A4 box — that is verified for real, through
// headless Chromium, in offer-document-print-pages.test.ts. Keep both: this file
// pins the structural decisions, that one pins the physical output.

test("the max-signer proposal emits a page element per declared page (PR #124)", () => {
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

test("the welcome letter greets EVERY owner in both renderers (PR #124 sweep)", () => {
  // The legacy clientNames + secondaryCustomerName greeting dropped owners 3+,
  // so a three-owner proposal opened "Dear A and B," and ignored the third.
  const owners = [individualOwner(1), individualOwner(2), individualOwner(3)];
  for (const html of [proposalHtmlFor(owners), reactPrintHtmlFor(owners)]) {
    assert.match(html, /Dear Owner 1, Owner 2 and Owner 3,/);
  }
});

test("combined honorifics are stripped whole, not partially (CodeRabbit)", () => {
  // Matching a SINGLE honorific left the rest behind: "Mr & Mrs Smith" greeted
  // the clients as "Dear & Mrs Smith,".
  const person = createIndividualOwner("o1");
  for (const [input, expected] of [
    ["Mr & Mrs Smith", "Smith"],
    ["Mr and Ms Nguyen", "Nguyen"],
    ["Dr Patel", "Patel"],
    ["Mr & Mrs & Dr Chen", "Chen"],
  ] as const) {
    assert.equal(
      formatOwnerGreetingNames([
        { ...person, displayName: input },
        { ...person, id: "o2", displayName: "Jane Doe" },
      ]),
      `${expected} and Jane Doe`,
      `honorific not fully stripped from "${input}"`,
    );
  }
});

test("honorifics are stripped but company owners keep their legal name", () => {
  const person = createIndividualOwner("o1");
  const company = createCompanyOwner("c1");
  assert.equal(
    formatOwnerGreetingNames([
      { ...person, displayName: "Mr Mahesh Kumar" },
      { ...company, displayName: "Rakhi Pty Ltd" },
    ]),
    "Mahesh Kumar and Rakhi Pty Ltd",
  );
});

// ─── The legal documents: Tender + Contract annexure ───
// These are the 3rd and 4th signature renderers. The proposal + browser-print
// pair was fixed first; both of these kept every signature block on one A4 page.

test("the Tender execution page paginates at max signers and foots truly (PR #124)", () => {
  const owners = Array.from({ length: MAX_OWNER_SIGNERS }, (_, i) =>
    individualOwner(i + 1),
  );
  const html = buildTenderHtml(buildProposalInput(snapshotWithOwners(owners)));

  const pages = physicalPageCount(html);
  const { lastPage, total } = footerPaging(html);
  assert.equal(
    pages,
    total,
    `Tender pages (${pages}) must equal the footer total (${total})`,
  );
  assert.equal(lastPage, total);
  assert.match(html, /Acceptance &amp; Execution \(cont\.\)/);
});

test("Tender signature anchors stay globally indexed across pages (PR #124)", () => {
  // Pagination must NOT restart the anchor numbering: sigOwner{k} maps to
  // DocuSign recipient k, so a per-page reset would orphan anchors and mis-route
  // signature tabs on a legally executed document.
  const owners = Array.from({ length: MAX_OWNER_SIGNERS }, (_, i) =>
    individualOwner(i + 1),
  );
  const html = buildTenderHtml(buildProposalInput(snapshotWithOwners(owners)));
  for (let k = 1; k <= MAX_OWNER_SIGNERS; k++) {
    assert.ok(
      html.includes(`sigOwner${k}`),
      `anchor sigOwner${k} missing from the Tender`,
    );
  }
  // Exactly one of each — a duplicate would mean the index restarted per page.
  for (let k = 1; k <= MAX_OWNER_SIGNERS; k++) {
    const hits = html.split(`sigOwner${k}\\`).length - 1;
    assert.ok(hits <= 1, `anchor sigOwner${k} appears ${hits} times`);
  }
  assert.ok(html.includes("sigBuilder"));
});

test("a single-signer Tender keeps one execution page", () => {
  const html = buildTenderHtml(
    buildProposalInput(snapshotWithOwners([individualOwner(1)])),
  );
  const { lastPage, total } = footerPaging(html);
  assert.equal(physicalPageCount(html), total);
  assert.equal(lastPage, total);
  assert.doesNotMatch(html, /Acceptance &amp; Execution \(cont\.\)/);
});

test("the contract annexure paginates its overflow signers (PR #124)", () => {
  // The annexure exists to carry MAX_OWNER_SIGNERS - 1 overflow signers — the
  // exact case where a single page overflowed and could split a signature block
  // away from the name it belongs to.
  const signers = Array.from({ length: MAX_OWNER_SIGNERS - 1 }, (_, i) => ({
    name: `Director ${i + 1}`,
    capacity: "Director",
    entityName: "Rakhi Pty Ltd",
  }));
  const html = buildContractSignatureAnnexureHtml({
    reference: "RC-1001-R1",
    siteAddress: "1 Test St, Sydney NSW 2000",
    ownerNamesLine: "Rakhi Pty Ltd",
    signers,
  });

  assert.ok(
    physicalPageCount(html) > 1,
    "9 annexure signers must span more than one page",
  );
  assert.match(html, /Owner Signature Schedule \(cont\.\)/);
  // Global anchor indices preserved across the page split.
  for (let k = 1; k <= signers.length; k++) {
    assert.ok(html.includes(`sigAnnex${k}`), `anchor sigAnnex${k} missing`);
  }
  // The binding preamble appears once (first page only), the legal closing once.
  assert.equal(html.split("forms part of").length - 1, 1);
  assert.equal(html.split("legal system of record").length - 1, 1);
});

test("a two-signer annexure stays on one page", () => {
  const html = buildContractSignatureAnnexureHtml({
    reference: "RC-1001-R1",
    siteAddress: "1 Test St, Sydney NSW 2000",
    ownerNamesLine: "A & B",
    signers: [{ name: "A" }, { name: "B" }],
  });
  assert.equal(physicalPageCount(html), 1);
  assert.doesNotMatch(html, /\(cont\.\)/);
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
