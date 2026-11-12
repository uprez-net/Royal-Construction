import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { OfferWorkspacePrintTemplate } from "@/components/offers/new-workflow/offer-workspace-print-template";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import {
  buildOfferPrintTemplateData,
  formatDateDisplay,
} from "@/lib/offer/workspace-print-template";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  deserializeWorkspace,
  INITIAL_TENDER_GATE,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import { revisionPreparedDate } from "@/lib/offer/revision-prepared-date";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// Backs the read-only revision viewer: a superseded revision is re-rendered
// from its stored snapshot, so the render must reproduce that revision rather
// than pick up today's date or collide with the live document when printing.

const SNAPSHOT: OfferWorkspaceSnapshot = {
  job: INITIAL_OFFER_JOB,
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
  tenderGate: INITIAL_TENDER_GATE,
  adminContentVersion: 0,
  extraCosts: INITIAL_EXTRA_COSTS,
  calcVersion: LEGACY_CALC_VERSION,
};

const proposalInput = buildProposalInput(SNAPSHOT);

test("stamps the supplied prepared date instead of today", () => {
  // Given a revision drawn up well in the past
  const preparedDate = new Date(2024, 2, 17);

  // When
  const data = buildOfferPrintTemplateData({ ...proposalInput, preparedDate });

  // Then the document carries that date, not the date it was viewed
  assert.equal(data.preparedDateLabel, "17/03/2024");
});

test("a re-sent revision prints the date of its latest send", () => {
  // The viewer dated every re-render by when the revision was created, so a
  // revision emailed again weeks later printed a date the customer never saw.
  const createdAt = new Date(2026, 5, 2);
  const lastSentAt = new Date(2026, 6, 21, 15, 40);

  const data = buildOfferPrintTemplateData({
    ...proposalInput,
    preparedDate: revisionPreparedDate({
      lastSentAt: lastSentAt.toISOString(),
      createdAt: createdAt.toISOString(),
    }),
  });

  assert.equal(data.preparedDateLabel, formatDateDisplay(lastSentAt));
  assert.notEqual(data.preparedDateLabel, formatDateDisplay(createdAt));
});

test("a revision never sent prints the date it was drawn up", () => {
  const createdAt = new Date(2026, 5, 2);

  const data = buildOfferPrintTemplateData({
    ...proposalInput,
    preparedDate: revisionPreparedDate({
      lastSentAt: null,
      createdAt: createdAt.toISOString(),
    }),
  });

  assert.equal(data.preparedDateLabel, formatDateDisplay(createdAt));
});

test("the viewer and its loader pass the latest send through", () => {
  // The dialog is a client component and the loader is "use server", so neither
  // can run here. Reverting either line would leave the tests above green.
  const dialog = readFileSync(
    join(
      process.cwd(),
      "components/offers/new-workflow/offer-revision-viewer-dialog.tsx",
    ),
    "utf8",
  );
  assert.match(dialog, /preparedDate=\{revisionPreparedDate\(revision\)\}/);

  const data = readFileSync(
    join(process.cwd(), "lib/domain/offers/queries.ts"),
    "utf8",
  );
  const start = data.indexOf(
    "export async function loadOfferRevisionSnapshot(",
  );
  assert.ok(start >= 0, "loadOfferRevisionSnapshot not found");
  const end = data.indexOf("\n}\n", start);
  // Without this, a missing terminator slices to -1 — the whole rest of the
  // file — and the assertions below would match some other loader and pass.
  assert.ok(end > start, "loadOfferRevisionSnapshot has no closing brace");
  const loader = data.slice(start, end);
  const sendsStart = loader.indexOf("documentSends:");
  const sendsEnd = loader.indexOf("take: 1", sendsStart);
  assert.ok(
    sendsStart >= 0 && sendsEnd > sendsStart,
    "latest send query missing",
  );
  const sendsQuery = loader.slice(sendsStart, sendsEnd);
  assert.match(sendsQuery, /select:\s*\{\s*sentAt:\s*true\s*\}/);
  assert.match(sendsQuery, /orderBy:\s*\{\s*sentAt:\s*"desc"\s*\}/);
  assert.match(loader, /lastSentAt:\s*offer\.documentSends\[0\]\?\.sentAt/);
});

test("falls back to today when no prepared date is supplied", () => {
  // Given the live draft, which passes no preparedDate

  // When
  const data = buildOfferPrintTemplateData(proposalInput);

  // Then
  const today = new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  assert.equal(data.preparedDateLabel, today);
});

test("screen render is excluded from printing, print render is not", () => {
  // Given the same proposal rendered for each surface
  // When
  const screenHtml = renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...proposalInput,
      images: EMPTY_OFFER_IMAGES,
      screen: true,
    }),
  );
  const printHtml = renderToStaticMarkup(
    createElement(OfferWorkspacePrintTemplate, {
      ...proposalInput,
      images: EMPTY_OFFER_IMAGES,
    }),
  );

  // Then only the print render carries the attribute that globals.css unwraps
  // and force-displays when printing — otherwise an open viewer would print on
  // top of the live offer.
  assert.ok(!screenHtml.includes('data-offer-print-template="true"'));
  assert.ok(screenHtml.includes('data-offer-print-template="screen"'));
  assert.ok(screenHtml.includes("print:hidden"));

  assert.ok(printHtml.includes('data-offer-print-template="true"'));
  assert.ok(printHtml.includes("print:block"));
});

test("a stored snapshot round-trips to the same prices the workspace showed", () => {
  // Given a snapshot persisted and read back exactly as the viewer loads it
  const restored = deserializeWorkspace(
    parseWorkspaceState(
      JSON.parse(JSON.stringify(serializeWorkspace(SNAPSHOT))),
    ),
  );

  // When
  const restoredInput = buildProposalInput(restored);

  // Then the viewer cannot drift from the live workspace's derivation
  assert.deepEqual(restoredInput.customerPrice, proposalInput.customerPrice);
  assert.equal(
    restoredInput.standardPriceIncGst,
    proposalInput.standardPriceIncGst,
  );
});
