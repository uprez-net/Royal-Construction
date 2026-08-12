import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STANDARD_INCLUSION_ENTRIES,
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
  getSummaryInclusions,
  inclusionPageStartIndexes,
  mergeCostScheduleIntoSchedule,
  UNCATEGORISED_INCLUSION_LABEL,
  type OfferInclusionEntry,
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

// ─── One list: spec + optional summary ───

test("every seeded entry carries a spec, and any summary it carries is non-empty", () => {
  for (const entry of STANDARD_INCLUSION_ENTRIES) {
    assert.ok(entry.spec.trim().length > 0, "every entry needs a spec");
    if (entry.summary !== undefined) {
      assert.ok(
        entry.summary.trim().length > 0,
        "a summary, if present, must be non-empty",
      );
    }
  }
});

test("every template schedule row survives as an entry, in order", () => {
  const specs = STANDARD_INCLUSION_ENTRIES.map((entry) => entry.spec);

  for (const row of STANDARD_INCLUSIONS_SCHEDULE) {
    assert.ok(
      specs.includes(row.specification),
      `template row "${row.category}" must survive into the entry list`,
    );
  }
});

test("the seeded summaries still cover the 14 items page 4 used to print", () => {
  assert.equal(getSummaryInclusions(STANDARD_INCLUSION_ENTRIES).length, 14);
});

test("the page 4 list is exactly the entries carrying a summary, in order", () => {
  const entries: OfferInclusionEntry[] = [
    { spec: "Full spec A", summary: "Short A" },
    { spec: "Full spec B" },
    { spec: "Full spec C", summary: "Short C" },
  ];

  assert.deepEqual(getSummaryInclusions(entries), ["Short A", "Short C"]);
});

test("a blank summary is treated as no summary, not as an empty bullet", () => {
  assert.deepEqual(getSummaryInclusions([{ spec: "S", summary: "   " }]), []);
});

test("a new offer draft seeds the full template entry list", () => {
  assert.deepEqual(
    INITIAL_OFFER_DRAFT.inclusionSchedule,
    STANDARD_INCLUSION_ENTRIES,
  );
});

// ─── Migrations ───

test("v2 snapshots migrate straight through to v4 seeded from the template", () => {
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
  }) as {
    schemaVersion: number;
    draft: { inclusionSchedule: OfferInclusionEntry[] };
  };

  assert.equal(migrated.schemaVersion, 5);
  assert.deepEqual(migrated.draft.inclusionSchedule, STANDARD_INCLUSION_ENTRIES);
});

// v3 briefly stored the schedule as plain strings beside a separately-edited
// inclusionBullets array. The two contradicted each other in real offers — page
// 4 promised "60mm stone benchtops" while page 6 promised "40mm engineered
// stone" — so the schedule (the contractual statement) wins and the bullets are
// dropped rather than guessed at.
test("v3 snapshots migrate to v4, keeping the schedule and dropping the bullets", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 3,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      inclusionBullets: ["60mm stone benchtops throughout"],
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: ["40mm engineered stone — kitchen island."],
    },
  }) as {
    schemaVersion: number;
    draft: {
      inclusionSchedule: OfferInclusionEntry[];
      inclusionBullets?: unknown;
    };
  };

  assert.equal(migrated.schemaVersion, 5);
  assert.deepEqual(migrated.draft.inclusionSchedule, [
    { spec: "40mm engineered stone — kitchen island." },
  ]);
  assert.equal(
    migrated.draft.inclusionBullets,
    undefined,
    "the stale bullet list must not survive — it is the contradiction we are removing",
  );
});

test("an estimator who emptied the schedule in v3 keeps it empty in v4", () => {
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
  }) as { draft: { inclusionSchedule: OfferInclusionEntry[] } };

  assert.deepEqual(migrated.draft.inclusionSchedule, []);
});

test("v4 entries are left untouched by the migration", () => {
  const entries = [{ spec: "Already an entry", summary: "Short" }];
  const migrated = migrateWorkspaceState({
    schemaVersion: 4,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: entries,
    },
  }) as { draft: { inclusionSchedule: OfferInclusionEntry[] } };

  assert.deepEqual(migrated.draft.inclusionSchedule, entries);
});

// ─── Pulling cost-schedule wording into the schedule ───

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
    [{ spec: "Existing spec" }, { spec: "Shared wording" }],
    [
      costLine({ id: "a", offerTenderLineItem: "Shared wording" }),
      costLine({ id: "b", offerTenderLineItem: "New wording" }),
    ],
  );

  assert.deepEqual(result, [
    { spec: "Existing spec" },
    { spec: "Shared wording" },
    { spec: "New wording" },
  ]);
});

// Cost-schedule wording is contractual, not a sales line, so a pulled entry
// never arrives with a summary — the estimator decides what earns page 4.
test("pulled entries carry no summary", () => {
  const result = mergeCostScheduleIntoSchedule(
    [],
    [costLine({ id: "a", offerTenderLineItem: "Pulled" })],
  );

  assert.deepEqual(result, [{ spec: "Pulled" }]);
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

  assert.deepEqual(result, [{ spec: "Kept" }]);
});

test("pulling is idempotent and preserves existing summaries", () => {
  const lines = [costLine({ id: "a", offerTenderLineItem: "Once" })];
  const seeded: OfferInclusionEntry[] = [{ spec: "Kept", summary: "Sales line" }];
  const once = mergeCostScheduleIntoSchedule(seeded, lines);
  const twice = mergeCostScheduleIntoSchedule(once, lines);

  assert.deepEqual(twice, once);
  assert.deepEqual(twice[0], { spec: "Kept", summary: "Sales line" });
});

// ─── One exclusion rule across every surface ───

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

// ─── Rendering ───

function snapshotWithSchedule(
  inclusionSchedule: readonly OfferInclusionEntry[],
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

test("page 4 prints the summary labels, the schedule prints the specs", () => {
  const html = buildProposalHtml(
    buildProposalInput(
      snapshotWithSchedule([
        { spec: "Long contractual sentence about stone.", summary: "Stone benchtops" },
        { spec: "Long contractual sentence about tiling." },
      ]),
    ),
    EMPTY_OFFER_IMAGES,
  );

  assert.match(html, /Stone benchtops/, "summary belongs on the investment page");
  assert.match(
    html,
    /Long contractual sentence about tiling\./,
    "spec belongs in the schedule",
  );
});

test("an entry with no summary never reaches the investment page", () => {
  const html = buildProposalHtml(
    buildProposalInput(
      snapshotWithSchedule([{ spec: "Schedule only, no summary." }]),
    ),
    EMPTY_OFFER_IMAGES,
  );
  const investmentPage =
    html.split('class="page"').find((page) => page.includes("Investment summary")) ??
    "";

  assert.doesNotMatch(investmentPage, /Schedule only, no summary\./);
});

test("the offer PDF prints the draft schedule, not the template constant", () => {
  const html = buildProposalHtml(
    buildProposalInput(
      snapshotWithSchedule([
        { spec: "Bespoke spec one" },
        { spec: "Bespoke spec two" },
      ]),
    ),
    EMPTY_OFFER_IMAGES,
  );

  assert.match(html, /Bespoke spec one/);
  assert.match(html, /Bespoke spec two/);
  assert.doesNotMatch(html, /Engineered slab/);
});

test("the offer PDF keeps the Category / Specification table", () => {
  const html = buildProposalHtml(
    buildProposalInput(
      snapshotWithSchedule([{ spec: "Only spec", category: "Concrete Slab" }]),
    ),
    EMPTY_OFFER_IMAGES,
  );

  assert.match(html, /<th>Category<\/th>/);
  assert.match(html, /<th>Specification<\/th>/);
  assert.match(html, /Concrete Slab/);
});

test("the tender keeps its numbered four-column schedule", () => {
  const html = buildTenderHtml(
    buildProposalInput(
      snapshotWithSchedule([{ spec: "Tender spec", category: "Tiling" }]),
    ),
  );

  assert.match(html, /Tender spec/);
  assert.match(html, /<th>Category<\/th>/);
  assert.match(html, /<th>Status<\/th>/);
  assert.match(html, /Tiling/);
});

// An entry pulled from the cost schedule or typed by an estimator has no
// category. It must never print an empty cell on a fixed-price contract.
test("an entry with no category prints Miscellaneous on both documents", () => {
  const snapshot = snapshotWithSchedule([{ spec: "Pulled from cost schedule." }]);

  const offer = buildProposalHtml(buildProposalInput(snapshot), EMPTY_OFFER_IMAGES);
  const tender = buildTenderHtml(buildProposalInput(snapshot));

  assert.match(offer, new RegExp(UNCATEGORISED_INCLUSION_LABEL));
  assert.match(tender, new RegExp(UNCATEGORISED_INCLUSION_LABEL));
});

test("a blank category is treated as missing, not printed as an empty cell", () => {
  const html = buildProposalHtml(
    buildProposalInput(snapshotWithSchedule([{ spec: "S", category: "   " }])),
    EMPTY_OFFER_IMAGES,
  );

  assert.match(html, new RegExp(UNCATEGORISED_INCLUSION_LABEL));
});

test("v4 entries regain their category by matching the seeded spec", () => {
  const seeded = STANDARD_INCLUSION_ENTRIES[1];
  const migrated = migrateWorkspaceState({
    schemaVersion: 4,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: [{ spec: seeded.spec }, { spec: "An estimator wrote this." }],
    },
  }) as {
    schemaVersion: number;
    draft: { inclusionSchedule: OfferInclusionEntry[] };
  };

  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.draft.inclusionSchedule[0].category, seeded.category);
  assert.equal(
    migrated.draft.inclusionSchedule[1].category,
    undefined,
    "a spec with no template match stays uncategorised and prints Miscellaneous",
  );
});

test("an empty schedule renders no inclusions page at all", () => {
  const html = buildProposalHtml(
    buildProposalInput(snapshotWithSchedule([])),
    EMPTY_OFFER_IMAGES,
  );

  assert.doesNotMatch(html, /Full inclusions schedule/);
});

// The tender numbers every inclusion; the offer's Category/Specification table
// never did. Numbering must run 1..n unbroken across the tender's page breaks.
test("tender numbering continues across page breaks", () => {
  const specs = Array.from({ length: 60 }, (_, i) => ({
    spec: `Specification ${i + 1}`,
    category: `Cat ${i + 1}`,
  }));
  const html = buildTenderHtml(buildProposalInput(snapshotWithSchedule(specs)));

  const numbers = [...html.matchAll(/<td class="num">(\d+)<\/td>/g)].map((m) =>
    Number(m[1]),
  );
  assert.equal(numbers.length, 60, "every inclusion should be numbered once");
  assert.deepEqual(
    numbers,
    Array.from({ length: 60 }, (_, i) => i + 1),
    "numbering must run 1..60 unbroken across page breaks",
  );
});

// ─── Pagination budgets by height, because the specs are estimator-editable ───

test("long specifications paginate more conservatively than short ones", () => {
  const short = Array.from({ length: 30 }, (_, i) => ({ spec: `Item ${i + 1}` }));
  const long = Array.from({ length: 30 }, (_, i) => ({
    spec: `Item ${i + 1}: ${"supply and install all materials, fixings and labour to complete this element in full accordance with the approved plans and the relevant Australian Standards. ".repeat(2)}`,
  }));

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

test("chunking never drops or reorders an entry", () => {
  const entries = Array.from({ length: 47 }, (_, i) => ({
    spec: `Specification ${i + 1}`,
  }));

  assert.deepEqual(chunkInclusionSchedule(entries).flat(), entries);
});

test("an empty schedule chunks to zero pages", () => {
  assert.deepEqual(chunkInclusionSchedule([]), []);
});

test("page start indexes make numbering continuous", () => {
  const entries = Array.from({ length: 47 }, (_, i) => ({
    spec: `Specification ${i + 1}`,
  }));
  const pages = chunkInclusionSchedule(entries);
  const starts = inclusionPageStartIndexes(pages);

  assert.equal(starts[0], 0);
  starts.forEach((start, index) => {
    const expected = pages
      .slice(0, index)
      .reduce((sum, page) => sum + page.length, 0);
    assert.equal(
      start,
      expected,
      `page ${index} must resume after its predecessors`,
    );
  });
});
