import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STANDARD_INCLUSION_SPECIFICATIONS,
  STANDARD_INCLUSIONS_SCHEDULE,
} from "../../lib/offer/workspace-proposal-content";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  chunkInclusionSchedule,
  inclusionPageStartIndexes,
  mergeCostScheduleIntoSchedule,
  type OfferWorkspaceCostLine,
} from "../../lib/offer/workspace-model";
import { getVisibleExclusions } from "../../lib/offer/workspace-print-template";
import {
  CURRENT_WORKSPACE_SCHEMA_VERSION,
  INITIAL_TENDER_GATE,
  migrateWorkspaceState,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildTenderHtml } from "../../lib/offer/offer-tender-html";

// REGRESSION: the state schema pinned `schemaVersion: z.literal(2)` while
// serialize wrote CURRENT_WORKSPACE_SCHEMA_VERSION. Bumping the constant made
// every parse throw — and resolveOfferContractValue swallows that in a catch,
// so the only visible symptom was contract values silently rendering as "—".
// The literal is now derived from the constant; this pins them together.
test("the parsed schema version tracks the current schema version constant", () => {
  const migrated = migrateWorkspaceState({ schemaVersion: 1, job: {} }) as {
    schemaVersion: number;
  };

  assert.equal(migrated.schemaVersion, CURRENT_WORKSPACE_SCHEMA_VERSION);
});

test("STANDARD_INCLUSION_SPECIFICATIONS is every template specification, in order", () => {
  assert.deepEqual(
    STANDARD_INCLUSION_SPECIFICATIONS,
    STANDARD_INCLUSIONS_SCHEDULE.map((row) => row.specification),
  );
});

test("a new offer draft seeds the full template schedule", () => {
  assert.deepEqual(
    INITIAL_OFFER_DRAFT.inclusionSchedule,
    STANDARD_INCLUSION_SPECIFICATIONS,
  );
});

test("v2 snapshots migrate to v3 seeded with the template schedule", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 2,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: ["A"],
      exclusionBullets: [],
      termsSummary: "T",
    },
  }) as { schemaVersion: number; draft: { inclusionSchedule: string[] } };

  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(
    migrated.draft.inclusionSchedule,
    STANDARD_INCLUSION_SPECIFICATIONS,
  );
});

test("migration does not clobber a schedule that is already present", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 2,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: [],
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: ["Only this one"],
    },
  }) as { draft: { inclusionSchedule: string[] } };

  assert.deepEqual(migrated.draft.inclusionSchedule, ["Only this one"]);
});

test("an estimator who empties the schedule keeps it empty through v3", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 3,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: [],
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: [],
    },
  }) as { draft: { inclusionSchedule: string[] } };

  assert.deepEqual(migrated.draft.inclusionSchedule, []);
});

// ─── Pulling cost-schedule wording into the schedule (Task 2) ───

function costLine(
  overrides: Partial<OfferWorkspaceCostLine>,
): OfferWorkspaceCostLine {
  return {
    ...INITIAL_COST_LINES[0],
    id: "test-line",
    includedInContract: true,
    costExGst: 1000,
    offerTenderLineItem: "Test wording",
    ...overrides,
  };
}

test("pulling from the cost schedule appends only missing wording", () => {
  const result = mergeCostScheduleIntoSchedule(
    ["Existing spec", "Shared wording"],
    [
      costLine({ id: "a", offerTenderLineItem: "Shared wording" }),
      costLine({ id: "b", offerTenderLineItem: "New wording" }),
    ],
  );

  assert.deepEqual(result, ["Existing spec", "Shared wording", "New wording"]);
});

test("pulling ignores excluded and unpriced cost lines", () => {
  const result = mergeCostScheduleIntoSchedule(
    [],
    [
      costLine({
        id: "a",
        includedInContract: false,
        offerTenderLineItem: "Excluded",
      }),
      costLine({ id: "b", costExGst: 0, offerTenderLineItem: "Unpriced" }),
      costLine({ id: "c", offerTenderLineItem: "   " }),
      costLine({ id: "d", offerTenderLineItem: "Kept" }),
    ],
  );

  assert.deepEqual(result, ["Kept"]);
});

test("pulling is idempotent", () => {
  const lines = [costLine({ id: "a", offerTenderLineItem: "Once" })];
  const once = mergeCostScheduleIntoSchedule([], lines);
  const twice = mergeCostScheduleIntoSchedule(once, lines);

  assert.deepEqual(twice, once);
});

// ─── One exclusion rule across every surface (Task 3) ───

test("visible exclusions union the draft bullets with the printed scope items", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: ["Bullet only"] };
  const scopeItem = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-1",
    label: "Scope only",
    includedInOfferDocument: true,
  };

  const result = getVisibleExclusions(draft, [scopeItem]);

  assert.ok(result.includes("Bullet only"), "draft bullet must print");
  assert.ok(result.includes("Scope only"), "scope item must print");
});

test("a scope item hidden from the document does not print", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: [] };
  const hidden = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-2",
    label: "Hidden item",
    includedInOfferDocument: false,
  };

  assert.deepEqual(getVisibleExclusions(draft, [hidden]), []);
});

test("a label duplicated across a bullet and a scope item prints once", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: ["Pool fencing"] };
  const dupe = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-3",
    label: "Pool fencing",
    includedInOfferDocument: true,
  };

  assert.deepEqual(getVisibleExclusions(draft, [dupe]), ["Pool fencing"]);
});

// ─── The schedule renders from the draft, as a list (Task 4) ───

function snapshotWithSchedule(
  inclusionSchedule: readonly string[],
): OfferWorkspaceSnapshot {
  return {
    job: INITIAL_OFFER_JOB,
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: { ...INITIAL_OFFER_DRAFT, inclusionSchedule },
    areaCalculator: INITIAL_AREA_CALCULATOR,
    workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    rateCardProduct: "DOUBLE_STOREY",
    rateCardTier: "MID",
    images: EMPTY_OFFER_IMAGES,
    tenderGate: INITIAL_TENDER_GATE,
    selectedPriceInput: "",
    standardPriceInput: "",
    overrideReason: "",
    priceAdjustmentLabel: "",
  } as OfferWorkspaceSnapshot;
}

test("the offer PDF prints the draft schedule, not the template constant", () => {
  const snapshot = snapshotWithSchedule(["Bespoke spec one", "Bespoke spec two"]);
  const html = buildProposalHtml(
    buildProposalInput(snapshot),
    EMPTY_OFFER_IMAGES,
  );

  assert.match(html, /Bespoke spec one/);
  assert.match(html, /Bespoke spec two/);
  assert.doesNotMatch(html, /Engineered slab/);
});

test("the offer PDF drops the Category column heading", () => {
  const html = buildProposalHtml(
    buildProposalInput(snapshotWithSchedule(["Only spec"])),
    EMPTY_OFFER_IMAGES,
  );

  assert.doesNotMatch(html, /<th>Category<\/th>/);
  assert.doesNotMatch(html, /<th>Specification<\/th>/);
});

test("the tender prints the draft schedule and drops its column headings", () => {
  const html = buildTenderHtml(
    buildProposalInput(snapshotWithSchedule(["Tender spec"])),
  );

  assert.match(html, /Tender spec/);
  assert.doesNotMatch(html, /<th>Category<\/th>/);
  assert.doesNotMatch(html, /<th>Status<\/th>/);
});

test("an empty schedule renders no inclusions page at all", () => {
  const html = buildProposalHtml(
    buildProposalInput(snapshotWithSchedule([])),
    EMPTY_OFFER_IMAGES,
  );

  assert.doesNotMatch(html, /Full inclusions schedule/);
});

test("schedule numbering continues across page breaks", () => {
  const specs = Array.from({ length: 60 }, (_, i) => `Specification ${i + 1}`);
  const html = buildProposalHtml(
    buildProposalInput(snapshotWithSchedule(specs)),
    EMPTY_OFFER_IMAGES,
  );

  // Page 2 must resume where page 1 stopped rather than restarting at 1.
  const starts = [...html.matchAll(/<ol class="inc" start="(\d+)"/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(starts.length > 1, "60 specs should paginate to more than one page");
  assert.equal(starts[0], 1);
  assert.ok(starts[1] > 1, "the second page must not restart numbering at 1");
});

// The schedule is estimator-editable free text, so pagination budgets by
// estimated wrapped height, not row count. A fixed rows-per-page count let long
// specifications overflow the page — and an overflowing page desyncs the
// "Page N of M" footer, the defect PR #124 fixed for signature blocks.
test("long specifications paginate more conservatively than short ones", () => {
  const short = Array.from({ length: 30 }, (_, i) => `Item ${i + 1}`);
  const long = Array.from(
    { length: 30 },
    (_, i) =>
      `Item ${i + 1}: ${"supply and install all materials, fixings and labour to complete this element in full accordance with the approved plans and the relevant Australian Standards. ".repeat(2)}`,
  );

  const shortPages = chunkInclusionSchedule(short);
  const longPages = chunkInclusionSchedule(long);

  assert.ok(
    longPages.length > shortPages.length,
    `long specs must need more pages (short=${shortPages.length}, long=${longPages.length})`,
  );
  assert.ok(
    longPages[0].length < shortPages[0].length,
    "a page of long specs must hold fewer entries",
  );
});

test("chunking never drops or reorders a specification", () => {
  const specs = Array.from({ length: 47 }, (_, i) => `Specification ${i + 1}`);
  const pages = chunkInclusionSchedule(specs);

  assert.deepEqual(pages.flat(), specs);
});

test("an empty schedule chunks to zero pages", () => {
  assert.deepEqual(chunkInclusionSchedule([]), []);
});

test("page start indexes make numbering continuous", () => {
  const specs = Array.from({ length: 47 }, (_, i) => `Specification ${i + 1}`);
  const pages = chunkInclusionSchedule(specs);
  const starts = inclusionPageStartIndexes(pages);

  assert.equal(starts[0], 0);
  starts.forEach((start, index) => {
    const expected = pages
      .slice(0, index)
      .reduce((sum, page) => sum + page.length, 0);
    assert.equal(start, expected, `page ${index} must resume after its predecessors`);
  });
});
