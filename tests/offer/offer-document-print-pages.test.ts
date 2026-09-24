import assert from "node:assert/strict";
import { test } from "vitest";

import { buildContractSignatureAnnexureHtml } from "@/lib/offer/contract-annexure-html";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildTenderHtml } from "@/lib/offer/offer-tender-html";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferWorkspacePrintTemplate } from "@/components/offers/new-workflow/offer-workspace-print-template";
import {
  createCompanyOwner,
  createIndividualOwner,
  createOfferSignatory,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  MAX_OWNER_NAME_LENGTH,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  MAX_OWNER_SIGNERS,
  type OfferOwner,
  type OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";

// Counting `<div class="page">` in the HTML only proves what the document
// DECLARES. It cannot see a page whose content overflows its A4 box, which is
// exactly how the Tender shipped 11 physical sheets while its footers said 10
// (PR #124 review). These tests render through headless Chromium — the same
// engine generatePDF uses — and count the pages that actually print.
//
// Chromium is required (puppeteer, already a dependency of the PDF path). If it
// cannot launch in this environment the tests fail loudly rather than skip: a
// silently-skipped print test is how this class of bug survived a review round.

const A4 = { format: "A4" as const, printBackground: true };

async function printedPageCount(html: string): Promise<number> {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf(A4);
    // Count page objects in the PDF. `/Type /Page` (not `/Pages`) appears once
    // per printed sheet; tolerate the optional space Chromium may or may not emit.
    const text = Buffer.from(pdf).toString("latin1");
    const matches = text.match(/\/Type\s*\/Page(?![s])/g) ?? [];
    return matches.length;
  } finally {
    await browser.close();
  }
}

function declaredPageTotal(html: string): number {
  const match = html.match(/Page \d+ of (\d+)/);
  assert.ok(match, "document declares no page total");
  return Number(match[1]);
}

function snapshotWithOwners(
  owners: OfferOwner[],
  allowances: readonly OfferWorkspaceScopeItem[] = INITIAL_ALLOWANCES,
): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB, owners },
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

function individualOwner(index: number): OfferOwner {
  const base = createIndividualOwner(`owner-${index}`);
  return {
    ...base,
    displayName: `Owner Number ${index}`,
    currentLocation: `${index} Somewhat Long Street Name, Sydney NSW 2000`,
    signatories: [
      {
        ...base.signatories[0],
        name: `Owner Number ${index}`,
        email: `owner${index}@example.com`,
        phone: "0400 000 000",
      },
    ],
  };
}

// Pad a name to exactly `length` characters so tests can sweep name length,
// which is the variable that actually drives wrapped height.
function nameOfLength(base: string, length: number): string {
  if (base.length >= length) {
    return base.slice(0, length);
  }
  const filler = " Holdings and Investments Group of Companies Australia";
  let out = base;
  while (out.length < length) {
    out += filler;
  }
  return out.slice(0, length);
}

// A company owner renders a header row PLUS one row per director, and carries a
// long legal name + ABN/ACN — the configuration that broke owner-count-based
// chunking and the unbounded cover cells.
function companyOwner(
  index: number,
  directors: number,
  nameLength = 70,
): OfferOwner {
  const base = createCompanyOwner(`company-${index}`);
  return {
    ...base,
    displayName: nameOfLength(
      `Kensington Grove Property No ${index} Pty Ltd`,
      nameLength,
    ),
    abn: `12 345 678 ${String(900 + index).slice(0, 3)}`,
    currentLocation: `Level ${index}, 100 Somewhat Long Street, Sydney NSW 2000`,
    signatories: Array.from({ length: directors }, (_, d) => ({
      ...createOfferSignatory(`company-${index}-dir-${d}`, "Director"),
      name: `Director Number ${d + 1} of Company ${index}`,
      email: `dir${d + 1}.co${index}@example.com`,
      phone: "0400 000 000",
    })),
  };
}

const maxOwners = () =>
  Array.from({ length: MAX_OWNER_SIGNERS }, (_, i) => individualOwner(i + 1));

// The exact configurations reported as mis-paginating, plus the ones that were
// already correct (so a fix cannot regress them). Each is asserted against real
// Chromium output for BOTH renderers.
const OWNER_CONFIGURATIONS: ReadonlyArray<{
  readonly label: string;
  readonly owners: OfferOwner[];
}> = [
  { label: "10 individuals", owners: maxOwners() },
  {
    label: "10 companies, one director each",
    owners: Array.from({ length: 10 }, (_, i) => companyOwner(i + 1, 1)),
  },
  { label: "1 company, 10 directors", owners: [companyOwner(1, 10)] },
  {
    label: "5 companies, 2 directors each",
    owners: Array.from({ length: 5 }, (_, i) => companyOwner(i + 1, 2)),
  },
  {
    label: "mixed individuals and companies",
    owners: [
      individualOwner(1),
      companyOwner(2, 3),
      individualOwner(3),
      companyOwner(4, 2),
    ],
  },
];

// Name-length sweep. The app enforces MAX_OWNER_NAME_LENGTH, so every length up
// to and including that ceiling must paginate correctly in ALL THREE renderers —
// the emailed proposal, the legal Tender, and the browser window.print() view.
// Earlier tests used ~70-character names and called them "worst-case"; they were
// not, and 110/140-character names broke every renderer (PR #124 review).
for (const nameLength of [70, 110, MAX_OWNER_NAME_LENGTH]) {
  const owners = Array.from({ length: 10 }, (_, i) =>
    companyOwner(i + 1, 1, nameLength),
  );
  const label = `10 companies, ${nameLength}-char legal names`;

  test(`Tender prints what it declares — ${label}`, async () => {
    const html = buildTenderHtml(
      buildProposalInput(snapshotWithOwners(owners)),
    );
    const printed = await printedPageCount(html);
    const declared = declaredPageTotal(html);
    assert.equal(
      printed,
      declared,
      `Tender printed ${printed} A4 pages but declares ${declared} (${label})`,
    );
  });

  test(`Proposal prints what it declares — ${label}`, async () => {
    const html = buildProposalHtml(
      buildProposalInput(snapshotWithOwners(owners)),
      EMPTY_OFFER_IMAGES,
    );
    const printed = await printedPageCount(html);
    const declared = declaredPageTotal(html);
    assert.equal(
      printed,
      declared,
      `Proposal printed ${printed} A4 pages but declares ${declared} (${label})`,
    );
  });

  // The React window.print() renderer is a THIRD, independent implementation. It
  // cannot be render-verified here: its layout comes from the app's compiled
  // Tailwind build, and standing up a fake stylesheet would only test the fake.
  //
  // Instead assert it makes the SAME pagination decisions as the emailed
  // renderer, which IS verified against real Chromium above. Both now share the
  // same budget constants and content-aware logic, so equal page counts mean the
  // React path inherits that verification. This is exactly the drift that shipped
  // (8 signature blocks per page here vs 6 there) and it is what this catches.
  test(`Browser print view paginates identically to the emailed PDF — ${label}`, () => {
    const input = buildProposalInput(snapshotWithOwners(owners));
    const emailed = buildProposalHtml(input, EMPTY_OFFER_IMAGES);
    const browser = renderToStaticMarkup(
      createElement(OfferWorkspacePrintTemplate, {
        ...input,
        images: EMPTY_OFFER_IMAGES,
      }),
    );
    assert.equal(
      declaredPageTotal(browser),
      declaredPageTotal(emailed),
      `browser print declares ${declaredPageTotal(browser)} pages but the emailed PDF declares ${declaredPageTotal(emailed)} (${label})`,
    );
    // And the same number of physical page elements are emitted.
    assert.equal(
      (browser.match(/min-h-\[297mm\]/g) ?? []).length,
      (emailed.match(/<div class="page">/g) ?? []).length,
      `renderers emit a different number of pages (${label})`,
    );
  });
}

for (const { label, owners } of OWNER_CONFIGURATIONS) {
  test(`Tender prints what it declares — ${label}`, async () => {
    const html = buildTenderHtml(
      buildProposalInput(snapshotWithOwners(owners)),
    );
    const printed = await printedPageCount(html);
    const declared = declaredPageTotal(html);
    assert.equal(
      printed,
      declared,
      `Tender printed ${printed} A4 pages but declares ${declared} (${label})`,
    );
  });

  test(`Proposal prints what it declares — ${label}`, async () => {
    const html = buildProposalHtml(
      buildProposalInput(snapshotWithOwners(owners)),
      EMPTY_OFFER_IMAGES,
    );
    const printed = await printedPageCount(html);
    const declared = declaredPageTotal(html);
    assert.equal(
      printed,
      declared,
      `Proposal printed ${printed} A4 pages but declares ${declared} (${label})`,
    );
  });
}

test("Tender prints exactly the number of pages it declares at max owners", async () => {
  const html = buildTenderHtml(
    buildProposalInput(snapshotWithOwners(maxOwners())),
  );
  const printed = await printedPageCount(html);
  const declared = declaredPageTotal(html);
  assert.equal(
    printed,
    declared,
    `Tender printed ${printed} A4 pages but declares ${declared} — a footer would appear on the wrong sheet`,
  );
});

test("Tender prints what it declares for a single owner", async () => {
  const html = buildTenderHtml(
    buildProposalInput(snapshotWithOwners([individualOwner(1)])),
  );
  assert.equal(await printedPageCount(html), declaredPageTotal(html));
});

test("Proposal prints exactly the number of pages it declares at max signers", async () => {
  const html = buildProposalHtml(
    buildProposalInput(snapshotWithOwners(maxOwners())),
    EMPTY_OFFER_IMAGES,
  );
  const printed = await printedPageCount(html);
  const declared = declaredPageTotal(html);
  assert.equal(
    printed,
    declared,
    `Proposal printed ${printed} A4 pages but declares ${declared}`,
  );
});

// Allowance pages are sized from estimated text length, one chunking shared by
// all three renderers, and no fixture above had more than the two seeded rows.
// Two long lists: rules that wrap to four lines, and seeded-shaped rows whose
// description stacks under the label.
const LONG_VARIATION_RULE =
  "Selections above this allowance are priced as a written variation before the affected works proceed on site.";
const ALLOWANCE_CONFIGURATIONS: ReadonlyArray<{
  readonly label: string;
  readonly allowances: readonly OfferWorkspaceScopeItem[];
}> = [
  {
    label: "30 allowances with long variation rules",
    allowances: Array.from({ length: 30 }, (_, i) => ({
      ...INITIAL_ALLOWANCES[0],
      id: `allowance-long-${i + 1}`,
      label: `Allowance item ${i + 1}`,
      variationRule: LONG_VARIATION_RULE,
      includedInOfferDocument: true,
      includedInTender: true,
    })),
  },
  {
    label: "40 seeded-shaped allowances",
    allowances: Array.from({ length: 40 }, (_, i) => ({
      ...INITIAL_ALLOWANCES[i % INITIAL_ALLOWANCES.length],
      id: `allowance-seeded-${i + 1}`,
      includedInOfferDocument: true,
      includedInTender: true,
    })),
  },
];

for (const { label, allowances } of ALLOWANCE_CONFIGURATIONS) {
  const snapshot = () => snapshotWithOwners([individualOwner(1)], allowances);

  test(`Tender prints what it declares — ${label}`, async () => {
    const html = buildTenderHtml(buildProposalInput(snapshot()));
    const printed = await printedPageCount(html);
    const declared = declaredPageTotal(html);
    assert.equal(
      printed,
      declared,
      `Tender printed ${printed} A4 pages but declares ${declared} (${label})`,
    );
  });

  test(`Proposal prints what it declares — ${label}`, async () => {
    const html = buildProposalHtml(
      buildProposalInput(snapshot()),
      EMPTY_OFFER_IMAGES,
    );
    const printed = await printedPageCount(html);
    const declared = declaredPageTotal(html);
    assert.equal(
      printed,
      declared,
      `Proposal printed ${printed} A4 pages but declares ${declared} (${label})`,
    );
  });

  test(`Browser print view paginates identically to the emailed PDF — ${label}`, () => {
    const input = buildProposalInput(snapshot());
    const emailed = buildProposalHtml(input, EMPTY_OFFER_IMAGES);
    const browser = renderToStaticMarkup(
      createElement(OfferWorkspacePrintTemplate, {
        ...input,
        images: EMPTY_OFFER_IMAGES,
      }),
    );
    assert.equal(declaredPageTotal(browser), declaredPageTotal(emailed));
    assert.equal(
      (browser.match(/min-h-\[297mm\]/g) ?? []).length,
      (emailed.match(/<div class="page">/g) ?? []).length,
      `renderers emit a different number of pages (${label})`,
    );
  });
}

// The Tender puts its allowances beneath the exclusions and Important Notes while
// they fit (layoutTenderAllowances). These pin that shared sheet against
// Chromium: seeded allowances that must share it, a long exclusions table that
// pushes them off it, a sheet filled close to its budget, and a long list split
// across both.
const LONG_EXCLUSIONS: readonly OfferWorkspaceScopeItem[] = Array.from(
  { length: 7 },
  (_, i) => ({
    ...INITIAL_EXCLUSIONS[0],
    id: `exclusion-long-${i + 1}`,
    label: `Excluded item number ${i + 1} with a longer name`,
    description: LONG_VARIATION_RULE,
    variationRule: LONG_VARIATION_RULE,
    includedInOfferDocument: true,
    includedInTender: true,
  }),
);
const SHORT_ALLOWANCES: readonly OfferWorkspaceScopeItem[] = Array.from(
  { length: 12 },
  (_, i) => ({
    ...INITIAL_ALLOWANCES[0],
    id: `allowance-short-${i + 1}`,
    label: `PC item ${i + 1}`,
    description: "",
    variationRule: "By variation.",
  }),
);
const SHARED_SHEET_CONFIGURATIONS: ReadonlyArray<{
  readonly label: string;
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
}> = [
  {
    label: "seeded allowances beneath seeded exclusions",
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
  },
  {
    label: "seeded allowances beneath a long exclusions table",
    allowances: INITIAL_ALLOWANCES,
    exclusions: LONG_EXCLUSIONS,
  },
  {
    label: "12 one-line allowances filling the shared sheet",
    allowances: SHORT_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
  },
  {
    label: "30 long allowances beneath a long exclusions table",
    allowances: ALLOWANCE_CONFIGURATIONS[0].allowances,
    exclusions: LONG_EXCLUSIONS,
  },
];

for (const { label, allowances, exclusions } of SHARED_SHEET_CONFIGURATIONS) {
  test(`Tender prints what it declares — ${label}`, async () => {
    const html = buildTenderHtml(
      buildProposalInput({
        ...snapshotWithOwners([individualOwner(1)], allowances),
        exclusions,
      }),
    );
    const printed = await printedPageCount(html);
    const declared = declaredPageTotal(html);
    assert.equal(
      printed,
      declared,
      `Tender printed ${printed} A4 pages but declares ${declared} (${label})`,
    );
  });
}

test("Contract annexure does not overflow its pages at max overflow signers", async () => {
  // The annexure carries MAX_OWNER_SIGNERS - 1 overflow signers and declares no
  // footer, so assert its rendered sheets match the pages it emits.
  const signers = Array.from({ length: MAX_OWNER_SIGNERS - 1 }, (_, i) => ({
    name: `Director Number ${i + 1}`,
    capacity: "Director",
    entityName: "Rakhi Holdings Pty Ltd",
  }));
  const html = buildContractSignatureAnnexureHtml({
    reference: "RC-1001-R1",
    siteAddress: "1 Somewhat Long Street Name, Sydney NSW 2000",
    ownerNamesLine: "Rakhi Holdings Pty Ltd (ABN/ACN 12 345 678 901)",
    signers,
  });
  const emitted = (html.match(/<div class="page">/g) ?? []).length;
  const printed = await printedPageCount(html);
  assert.equal(
    printed,
    emitted,
    `annexure printed ${printed} A4 pages from ${emitted} emitted pages — a signature block is splitting across sheets`,
  );
});
