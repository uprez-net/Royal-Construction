import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { OfferWorkspacePrintTemplate } from "@/components/offers/new-workflow/offer-workspace-print-template";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildTenderHtml } from "@/lib/offer/offer-tender-html";
import {
  buildOfferPrintTemplateData,
  type OfferPrintScopeRow,
} from "@/lib/offer/workspace-print-template";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import {
  ALLOWANCES_INTRO_LINES,
  ALLOWANCES_LINES_PER_PAGE,
  allowanceRowLines,
  CHARS_PER_LINE_ALLOWANCE_ITEM,
  CHARS_PER_LINE_ALLOWANCE_RULE,
  chunkAllowanceRows,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  estimateWrappedLines,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

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
    extraCosts: INITIAL_EXTRA_COSTS,
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

// Allowances default off the Offer document and on the Tender, so the offer
// tests tick the Offer box on the seeded rows themselves.
const offerTicked = INITIAL_ALLOWANCES.map((item) => ({
  ...item,
  includedInOfferDocument: true,
}));
const shown = offerTicked;
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
  // Guards every assertion below: without a row ticked for the Offer, these
  // tests would pass vacuously.
  assert.ok(shown.length > 0, "no default allowance is shown on the offer");
});

test("scopeRows still carries the ticked allowances", () => {
  const data = buildOfferPrintTemplateData(
    buildProposalInput(snapshotWith(offerTicked)),
  );
  assert.equal(data.scopeRows.length, shown.length);
  assert.deepEqual(
    data.scopeRows.map((row) => row.label),
    shown.map((item) => item.label),
  );
});

test("unticked allowances never reach scopeRows", () => {
  const data = buildOfferPrintTemplateData(
    buildProposalInput(snapshotWith(hidden)),
  );
  assert.equal(data.scopeRows.length, 0);
});

test("the printed offer discloses every ticked allowance", () => {
  const html = reactMarkup(snapshotWith(offerTicked));
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
    buildProposalInput(snapshotWith(offerTicked)),
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
  const html = reactMarkup(snapshotWith(offerTicked));
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
  const data = buildOfferPrintTemplateData(
    buildProposalInput(snapshotWith(items)),
  );
  assert.equal(data.scopeRows[0].description, "");
  assert.equal(data.scopeRows[0].variationRule, repeated);

  const html = reactMarkup(snapshotWith(items));
  const body = html.slice(html.indexOf("Prime cost"));
  const occurrences = body.split(repeated).length - 1;
  assert.equal(
    occurrences,
    1,
    `the same sentence printed ${occurrences} times in one row`,
  );
});

test("a genuinely distinct description is still printed", () => {
  const data = buildOfferPrintTemplateData(
    buildProposalInput(snapshotWith(offerTicked)),
  );
  const withDescription = data.scopeRows.find((row) => row.description !== "");
  assert.ok(withDescription, "the dedupe swallowed every description");
  assert.ok(
    reactMarkup(snapshotWith(offerTicked)).includes(
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
    buildProposalInput(snapshotWith(offerTicked)),
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
  const snapshot = snapshotWith(offerTicked);
  assert.equal(
    declaredPageTotal(reactMarkup(snapshot)),
    declaredPageTotal(
      buildProposalHtml(buildProposalInput(snapshot), EMPTY_OFFER_IMAGES),
    ),
  );
});

// ─── Pagination ─────────────────────────────────────────────────────────────
// Both offer renderers put every disclosed allowance on ONE fixed-height page
// and counted it as one. Thirty rows with real variation rules ran past the
// footer onto sheets "Page N of M" never declared.

const longRule =
  "Selections above this allowance are priced as a written variation before the affected works proceed on site. ".slice(
    0,
    120,
  );
const manyLongAllowances: OfferWorkspaceScopeItem[] = Array.from(
  { length: 30 },
  (_, index) => ({
    ...INITIAL_ALLOWANCES[0],
    id: `allowance-long-${index + 1}`,
    label: `Allowance item ${index + 1}`,
    variationRule: longRule.padEnd(120, "."),
    includedInOfferDocument: true,
  }),
);

test("the seeded allowances still fit one page", () => {
  assert.equal(chunkAllowanceRows(INITIAL_ALLOWANCES).length, 1);
});

test("a long allowance list splits into pages that each fit their budget", () => {
  const rows = buildOfferPrintTemplateData(
    buildProposalInput(snapshotWith(manyLongAllowances)),
  ).scopeRows;
  assert.equal(rows[0].variationRule.length, 120);
  const chunks = chunkAllowanceRows(rows);
  assert.ok(
    chunks.length > 1,
    `30 long rows packed into ${chunks.length} page`,
  );
  assert.equal(
    chunks.flat().length,
    rows.length,
    "pagination dropped or duplicated a row",
  );
  chunks.forEach((chunk, index) => {
    const budget =
      index === 0
        ? ALLOWANCES_LINES_PER_PAGE - ALLOWANCES_INTRO_LINES
        : ALLOWANCES_LINES_PER_PAGE;
    const used = chunk.reduce((sum, row) => sum + allowanceRowLines(row), 0);
    assert.ok(
      used <= budget,
      `page ${index + 1} uses ${used} of ${budget} lines`,
    );
  });
});

// The Download copy (window.print) is laid out by the app's Tailwind build, which
// no test can render, so the Chromium sheet counts cover only the emailed
// proposal and the Tender. This spells out what PrintAllowancesPage's classes
// make of a row and a page at zoom 1, the most cramped case. The first
// pagination reused the inclusions' one chrome line and 40-line budget: eight
// rows with four-line rules needed 840px of the ~804px a continued page has.
// Wrapping uses the shared per-line estimates, so this pins the row chrome and
// page budgets, not the character widths.
const PX_PER_MM = 96 / 25.4;
const DOWNLOAD_LINE_PX = 20; // text-sm, and the description's leading-5
const DOWNLOAD_ROW_CHROME_PX = 25; // py-3 top and bottom, plus the 1px border-b
const DOWNLOAD_DESCRIPTION_GAP_PX = 4; // mt-1
// min-h-[297mm] less py-[13mm], then the masthead (25px), section heading
// (108px), the table's mt-6 (24px), its header row (42px) and the footer (21px).
const DOWNLOAD_ROWS_PX = (297 - 26) * PX_PER_MM - 220;
// The first page's intro at leading-6, allowed four lines.
const DOWNLOAD_INTRO_PX = 4 * 24;

function downloadRowPx(row: OfferPrintScopeRow): number {
  const lines = (text: string, charsPerLine: number) =>
    estimateWrappedLines(text, charsPerLine) * DOWNLOAD_LINE_PX;
  const item =
    lines(row.label, CHARS_PER_LINE_ALLOWANCE_ITEM)
    + (row.description.trim()
      ? DOWNLOAD_DESCRIPTION_GAP_PX
        + lines(row.description, CHARS_PER_LINE_ALLOWANCE_ITEM)
      : 0);
  return (
    Math.max(item, lines(row.variationRule, CHARS_PER_LINE_ALLOWANCE_RULE))
    + DOWNLOAD_ROW_CHROME_PX
  );
}

test("every Download allowances page fits its A4 sheet", () => {
  const seededRows = Array.from({ length: 40 }, (_, index) => ({
    ...INITIAL_ALLOWANCES[index % INITIAL_ALLOWANCES.length],
    id: `allowance-seeded-${index + 1}`,
    includedInOfferDocument: true,
  }));
  // Short rows are where padding, not text, sets the height.
  const oneLineRows = Array.from({ length: 40 }, (_, index) => ({
    ...INITIAL_ALLOWANCES[0],
    id: `allowance-short-${index + 1}`,
    label: `PC item ${index + 1}`,
    description: "",
    variationRule: "By variation.",
    includedInOfferDocument: true,
  }));
  const fixtures: ReadonlyArray<
    readonly [string, readonly OfferWorkspaceScopeItem[]]
  > = [
    ["long variation rules", manyLongAllowances],
    ["seeded-shaped rows", seededRows],
    ["one-line rows", oneLineRows],
  ];
  for (const [label, allowances] of fixtures) {
    const rows = buildOfferPrintTemplateData(
      buildProposalInput(snapshotWith(allowances)),
    ).scopeRows;
    const chunks = chunkAllowanceRows(rows);
    assert.ok(chunks.length > 1, `${label}: the fixture never paginates`);
    chunks.forEach((chunk, index) => {
      const available =
        index === 0 ? DOWNLOAD_ROWS_PX - DOWNLOAD_INTRO_PX : DOWNLOAD_ROWS_PX;
      const used = chunk.reduce((sum, row) => sum + downloadRowPx(row), 0);
      assert.ok(
        used <= available,
        `${label}: page ${index + 1} needs ${used}px of ${Math.floor(available)}px`,
      );
    });
  }
});

test("both offer renderers count every allowance page in their footer", () => {
  const chunkCount = chunkAllowanceRows(
    buildOfferPrintTemplateData(
      buildProposalInput(snapshotWith(manyLongAllowances)),
    ).scopeRows,
  ).length;
  const emailedMany = declaredPageTotal(
    buildProposalHtml(
      buildProposalInput(snapshotWith(manyLongAllowances)),
      EMPTY_OFFER_IMAGES,
    ),
  );
  const emailedNone = declaredPageTotal(
    buildProposalHtml(
      buildProposalInput(snapshotWith(hidden)),
      EMPTY_OFFER_IMAGES,
    ),
  );
  const reactMany = declaredPageTotal(
    reactMarkup(snapshotWith(manyLongAllowances)),
  );

  assert.equal(
    reactMany,
    emailedMany,
    "the two renderers disagree on page count",
  );
  assert.equal(emailedMany - emailedNone, chunkCount);

  const reactHtml = reactMarkup(snapshotWith(manyLongAllowances));
  assert.equal(
    reactHtml.split("Prime cost &amp; provisional sums (cont.)").length - 1,
    chunkCount - 1,
    "the React template did not render one page per chunk",
  );
});

// Tender allowance amounts are intentionally omitted; the Offer disclosure and
// underlying customer price are unaffected.
test("Tender omits dollar-value allowances without changing the price", () => {
  const withAllowances = snapshotWith(INITIAL_ALLOWANCES);
  const withoutAllowances = snapshotWith([]);
  const html = buildTenderHtml(buildProposalInput(withAllowances));

  assert.doesNotMatch(
    html,
    /Prime Cost &amp; Provisional Sums|c-alw-item|allowances set out in this Tender/,
  );
  assert.equal(
    declaredPageTotal(html),
    declaredPageTotal(buildTenderHtml(buildProposalInput(withoutAllowances))),
  );
  assert.deepEqual(
    buildProposalInput(withAllowances).customerPrice,
    buildProposalInput(withoutAllowances).customerPrice,
  );
});
