import assert from "node:assert/strict";
import { test } from "node:test";

import { buildContractSignatureAnnexureHtml } from "../../lib/offer/contract-annexure-html";
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { buildTenderHtml } from "../../lib/offer/offer-tender-html";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
  createCompanyOwner,
  createIndividualOwner,
  createOfferSignatory,
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

// A company owner renders a header row PLUS one row per director, and carries a
// long legal name + ABN/ACN — the configuration that broke owner-count-based
// chunking and the unbounded cover cells.
function companyOwner(index: number, directors: number): OfferOwner {
  const base = createCompanyOwner(`company-${index}`);
  return {
    ...base,
    // Realistic worst-case AU legal name length — these cells are unbounded, so
    // name length is the variable that decides whether a cover overflows.
    displayName: `Kensington Grove Property Holdings and Investments Number ${index} Pty Ltd`,
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

for (const { label, owners } of OWNER_CONFIGURATIONS) {
  test(`Tender prints what it declares — ${label}`, async () => {
    const html = buildTenderHtml(buildProposalInput(snapshotWithOwners(owners)));
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
  const html = buildTenderHtml(buildProposalInput(snapshotWithOwners(maxOwners())));
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
