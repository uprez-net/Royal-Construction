import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferWorkspacePrintTemplate } from "../../components/offers/new-workflow/offer-workspace-print-template";
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { buildTenderHtml } from "../../lib/offer/offer-tender-html";
import {
  INITIAL_AREA_CALCULATOR,
  offerAreaBasisFromJob,
  rawTotalAreaSqm,
} from "../../lib/offer/workspace-area";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferWorkspaceJob,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import { buildAreaBreakdown } from "../../lib/offer/workspace-print-template";
import { buildWelcomeParagraphs } from "../../lib/offer/workspace-proposal-content";

// Every renderer summed its own subset of the floor areas. For one job the
// emailed snapshot printed 415 m² (no balcony, no void) under an "Alfresco +
// Balcony" cell holding alfresco alone; the printed copy printed 427 m² (no void)
// beside a Kitchen cell that was in no total; the Tender and the welcome letter
// said 415 — while the cover of the same proposal said 435. The grid cells also
// failed to add up to the total printed beside them.
//
// Every document now prints rawTotalAreaSqm, the figure the cover and the cost
// formulas already used, so no price moves.

const AREAS: Partial<OfferWorkspaceJob> = {
  groundFloorSqm: 200,
  firstFloorSqm: 150,
  garageSqm: 40,
  alfrescoPorchSqm: 20,
  porchSqm: 5,
  balconySqm: 12,
  voidSqm: 8,
  kitchenSqm: 20,
};

function snapshotWith(job: Partial<OfferWorkspaceJob>): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB, ...job },
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
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

function emailed(job: Partial<OfferWorkspaceJob>): string {
  return buildProposalHtml(buildProposalInput(snapshotWith(job)), EMPTY_OFFER_IMAGES);
}

function printed(job: Partial<OfferWorkspaceJob>): string {
  return renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...buildProposalInput(snapshotWith(job)),
      images: EMPTY_OFFER_IMAGES,
    }),
  );
}

function tender(job: Partial<OfferWorkspaceJob>): string {
  return buildTenderHtml(buildProposalInput(snapshotWith(job)));
}

function emailedCell(label: string, value: string): RegExp {
  return new RegExp(
    `<div class="cap">${label.replace("+", "\\+")}</div><div class="num">${value}</div>`,
  );
}

function printedCell(label: string, value: string): RegExp {
  return new RegExp(`>${label.replace("+", "\\+")}</p><p[^>]*>${value}</p>`);
}

const tenderTotal = (value: string) =>
  new RegExp(`<b>Total build area</b></td><td class="c-detail">${value}</td>`);

test("the emailed snapshot grid prints the one total and a real Alfresco + Balcony", () => {
  const html = emailed(AREAS);
  assert.match(html, emailedCell("Total Area", "435 m²"));
  assert.match(html, emailedCell("Alfresco + Balcony", "32 m²"));
  assert.match(html, emailedCell("Void", "8 m²"));
  // The cover already printed the right figure; it must agree with the grid.
  assert.match(html, /Total Build Area<\/td><td class="val">435 m²/);
});

test("the printed snapshot grid prints the one total and no Kitchen cell", () => {
  const html = printed(AREAS);
  assert.match(html, printedCell("Total Area", "435 m²"));
  assert.match(html, printedCell("Alfresco + Balcony", "32 m²"));
  assert.equal(html.includes(">Kitchen<"), false, "a Kitchen cell is in no total");
});

test("the Tender prints the same total build area", () => {
  assert.match(tender(AREAS), tenderTotal("435 m²"));
});

test("the welcome letter quotes the same area", () => {
  const job = { ...INITIAL_OFFER_JOB, ...AREAS };
  assert.ok(
    buildWelcomeParagraphs(job).some((p) => p.includes("all 435 square metres")),
  );
  assert.ok(emailed(AREAS).includes("all 435 square metres"));
  assert.ok(printed(AREAS).includes("all 435 square metres"));
});

test("a granny flat is in every total and gets its own cell", () => {
  const withGranny = { ...AREAS, grannyFlatSqm: 40 };
  const emailedHtml = emailed(withGranny);
  const printedHtml = printed(withGranny);
  assert.match(emailedHtml, emailedCell("Total Area", "475 m²"));
  assert.match(emailedHtml, emailedCell("Granny Flat", "40 m²"));
  assert.match(printedHtml, printedCell("Total Area", "475 m²"));
  assert.match(printedHtml, printedCell("Granny Flat", "40 m²"));
  assert.match(tender(withGranny), tenderTotal("475 m²"));
});

test("the grid cells add up to the printed total", () => {
  for (const job of [
    { ...INITIAL_OFFER_JOB, ...AREAS },
    { ...INITIAL_OFFER_JOB, ...AREAS, grannyFlatSqm: 40 },
    { ...INITIAL_OFFER_JOB, ...AREAS, voidSqm: 0 },
    {
      ...INITIAL_OFFER_JOB,
      groundFloorSqm: 187.35,
      firstFloorSqm: 142.1,
      garageSqm: 38.05,
      alfrescoPorchSqm: 17.4,
      porchSqm: 4.25,
      balconySqm: 9.9,
      voidSqm: 6.3,
      grannyFlatSqm: 61.7,
      kitchenSqm: 22.2,
    },
  ]) {
    const breakdown = buildAreaBreakdown(job);
    const cellSum = breakdown.cells.reduce((sum, cell) => sum + cell.sqm, 0);
    assert.ok(
      Math.abs(cellSum - breakdown.totalSqm) < 1e-9,
      `cells sum to ${cellSum} but the total is ${breakdown.totalSqm}`,
    );
    // The total is the figure the cover and the cost formulas already use.
    assert.equal(breakdown.totalSqm, rawTotalAreaSqm(offerAreaBasisFromJob(job)));
  }
});

test("an area value never splits from its unit when void and granny flat both show", () => {
  // Seven cells share the 174mm grid once both are set. The printed copy's
  // padded cells left ~61px for a value and "187.35 m²" is ~76px of monospace,
  // so it broke at the space and printed "m²" on a line of its own.
  const job = { ...AREAS, groundFloorSqm: 147.35, grannyFlatSqm: 40 };
  const values = [
    ...printed(job).matchAll(/<\/p><p class="([^"]*)">[\d.,]+ m²<\/p>/g),
  ];
  assert.equal(values.length, 7, "expected all seven area cells");
  assert.ok(values.some((match) => match[0].includes("187.35 m²")));
  for (const [cell, className] of values) {
    assert.ok(className.split(" ").includes("whitespace-nowrap"), `wraps: ${cell}`);
  }
  assert.match(emailed(job), /\.areatable \.num \{[^}]*white-space: nowrap/);
});

test("the printed snapshot carries the dwelling specifications the emailed one does", () => {
  const single = printed(AREAS);
  assert.match(single, /Major House Specifications/);
  assert.doesNotMatch(single, /Granny Home Specifications/);
  const dual = printed({ ...AREAS, hasGrannyHome: true, grannyBedrooms: 2 });
  assert.match(dual, /Major House Specifications/);
  assert.match(dual, /Granny Home Specifications/);
});

test("a single-storey job prints no First Floor cell", () => {
  const singleStorey = { ...AREAS, firstFloorSqm: 0 };
  const job = { ...INITIAL_OFFER_JOB, ...singleStorey };
  assert.equal(
    buildAreaBreakdown(job).cells.some((cell) => cell.label === "First Floor"),
    false,
    "a zero First Floor still has a cell",
  );
  assert.doesNotMatch(emailed(singleStorey), /<div class="cap">First Floor<\/div>/);
  assert.equal(printed(singleStorey).includes(">First Floor</p>"), false);
  assert.match(emailed(singleStorey), emailedCell("Total Area", "285 m²"));
});

test("the welcome letter keeps a fractional area", () => {
  const fractional = { ...AREAS, porchSqm: 5.5 };
  const job = { ...INITIAL_OFFER_JOB, ...fractional };
  assert.ok(
    buildWelcomeParagraphs(job).some((p) => p.includes("all 435.5 square metres")),
  );
  assert.ok(emailed(fractional).includes("all 435.5 square metres"));
  assert.ok(printed(fractional).includes("all 435.5 square metres"));
});
