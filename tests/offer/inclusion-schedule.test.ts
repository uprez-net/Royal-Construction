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
  inclusionPageStartIndexes,
  UNCATEGORISED_INCLUSION_LABEL,
  unreviewedDraftedRows,
  type OfferInclusionEntry,
} from "../../lib/offer/workspace-model";
import {
  buildOfferPrintTemplateData,
  getVisibleExclusions,
} from "../../lib/offer/workspace-print-template";
import {
  CURRENT_WORKSPACE_SCHEMA_VERSION,
  INITIAL_TENDER_GATE,
  migrateWorkspaceState,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import { collectOfferSendBlockers } from "../../lib/offer/offer-readiness";
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


test("every template schedule row survives as an entry, in order", () => {
  const specs = STANDARD_INCLUSION_ENTRIES.map((entry) => entry.spec);

  for (const row of STANDARD_INCLUSIONS_SCHEDULE) {
    assert.ok(
      specs.includes(row.specification),
      `template row "${row.category}" must survive into the entry list`,
    );
  }
});




test("a new offer draft seeds the full template entry list", () => {
  assert.deepEqual(
    INITIAL_OFFER_DRAFT.inclusionSchedule,
    STANDARD_INCLUSION_ENTRIES,
  );
});

// ─── Migrations ───

test("v2 snapshots migrate straight through to the current version", () => {
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

  assert.equal(migrated.schemaVersion, CURRENT_WORKSPACE_SCHEMA_VERSION);
  assert.deepEqual(migrated.draft.inclusionSchedule, STANDARD_INCLUSION_ENTRIES);
});

// v3 briefly stored the schedule as plain strings beside a separately-edited
// inclusionBullets array. The two contradicted each other in real offers — page
// 4 promised "60mm stone benchtops" while page 6 promised "40mm engineered
// stone" — so the schedule (the contractual statement) wins and the bullets are
// dropped rather than guessed at.
test("v3 snapshots keep the schedule and drop the stale bullets", () => {
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

  assert.equal(migrated.schemaVersion, CURRENT_WORKSPACE_SCHEMA_VERSION);
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
  const entries = [{ spec: "Already an entry", category: "Cat" }];
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

  assert.equal(migrated.schemaVersion, CURRENT_WORKSPACE_SCHEMA_VERSION);
  assert.equal(migrated.draft.inclusionSchedule[0].category, seeded.category);
  assert.equal(
    migrated.draft.inclusionSchedule[1].category,
    undefined,
    "a spec with no template match stays uncategorised and prints Miscellaneous",
  );
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

// ─── v6: the selling list moves off the schedule rows ───

// v5 asserted one selling line per contract row. On a real offer "All
// structural works — slab, frame, roof" covers six rows, so a per-row field
// could never hold it.
test("v5 summaries become the highlight list, in schedule order", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 5,
    job: {},
    draft: {
      headline: "H",
      introText: "I",
      exclusionBullets: [],
      termsSummary: "T",
      inclusionSchedule: [
        { spec: "Engineered slab.", summary: "All structural works", category: "Concrete Slab" },
        { spec: "Timber frame." },
        { spec: "40mm stone.", summary: "40mm stone benchtops", summaryFromSpec: "40mm stone." },
      ],
    },
  }) as {
    schemaVersion: number;
    draft: {
      inclusionHighlights: string[];
      inclusionSchedule: { spec: string; category?: string; summary?: unknown; summaryFromSpec?: unknown }[];
    };
  };

  assert.equal(migrated.schemaVersion, CURRENT_WORKSPACE_SCHEMA_VERSION);
  assert.deepEqual(migrated.draft.inclusionHighlights, [
    "All structural works",
    "40mm stone benchtops",
  ]);
  for (const entry of migrated.draft.inclusionSchedule) {
    assert.equal(entry.summary, undefined, "selling copy must not survive on a contract row");
    assert.equal(entry.summaryFromSpec, undefined);
  }
  assert.equal(migrated.draft.inclusionSchedule[0].spec, "Engineered slab.");
  assert.equal(migrated.draft.inclusionSchedule[0].category, "Concrete Slab");
});

test("a v5 offer with no summaries migrates to an empty highlight list", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 5,
    job: {},
    draft: {
      headline: "H", introText: "I", exclusionBullets: [], termsSummary: "T",
      inclusionSchedule: [{ spec: "Only a spec." }],
    },
  }) as { draft: { inclusionHighlights: string[] } };

  assert.deepEqual(migrated.draft.inclusionHighlights, []);
});

test("a v6 offer is left alone", () => {
  const migrated = migrateWorkspaceState({
    schemaVersion: 6,
    job: {},
    draft: {
      headline: "H", introText: "I", exclusionBullets: [], termsSummary: "T",
      inclusionHighlights: ["Mine"],
      inclusionSchedule: [{ spec: "S" }],
    },
  }) as { draft: { inclusionHighlights: string[] } };

  assert.deepEqual(migrated.draft.inclusionHighlights, ["Mine"]);
});

test("page 4 prints the highlight list, blanks dropped", () => {
  const snapshot = snapshotWithSchedule([{ spec: "S" }]);
  const data = buildOfferPrintTemplateData(
    buildProposalInput({
      ...snapshot,
      draft: { ...snapshot.draft, inclusionHighlights: ["Real line", "   "] },
    } as OfferWorkspaceSnapshot),
  );

  assert.deepEqual(data.summaryInclusions, ["Real line"]);
});

// Contract text the model wrote and nobody reviewed must stay visible.
test("AI-drafted rows are reported so they can be surfaced before send", () => {
  assert.deepEqual(
    unreviewedDraftedRows([
      { spec: "Mine" },
      { spec: "Drafted", draftedByAi: true },
      { spec: "Reviewed" },
    ]),
    [1],
  );
});

// ─── priced → promised → sold ───

// A model judgement about contract text must never stop a live deal going out.
test("an unresolved mismatch warns before send, never blocks", () => {
  const blockers = collectOfferSendBlockers({
    hasLead: true,
    needsOverrideReason: false,
    expiryState: "valid",
    inclusionFindingCount: 2,
  });
  const finding = blockers.find((b) => b.id === "inclusion-consistency");

  assert.ok(finding, "an unresolved mismatch must surface before send");
  assert.equal(finding.severity, "warn");
  assert.equal(finding.stepId, "offer-step-offer-document");
  assert.match(finding.label, /2 inclusion mismatches/);
});

test("one mismatch reads in the singular", () => {
  const blockers = collectOfferSendBlockers({
    hasLead: true, needsOverrideReason: false, expiryState: "valid",
    inclusionFindingCount: 1,
  });

  assert.match(
    blockers.find((b) => b.id === "inclusion-consistency")!.label,
    /1 inclusion mismatch/,
  );
});

test("no findings, no blocker", () => {
  const blockers = collectOfferSendBlockers({
    hasLead: true, needsOverrideReason: false, expiryState: "valid",
    inclusionFindingCount: 0,
  });

  assert.equal(blockers.some((b) => b.id === "inclusion-consistency"), false);
});

// ─── The offer sells; the tender contracts ───

// The full schedule is three pages of contractual detail. It belongs on the
// document that contracts, not the one that sells — and printing it on the
// offer also made the imbalance worse, giving inclusions three pages while
// exclusions got a single column beside the price.
test("the offer does not print the inclusions schedule", () => {
  const html = buildProposalHtml(
    buildProposalInput(
      snapshotWithSchedule([
        { spec: "A contractual sentence only the tender should carry.", category: "Tiling" },
      ]),
    ),
    EMPTY_OFFER_IMAGES,
  );

  assert.doesNotMatch(html, /Full inclusions schedule/);
  assert.doesNotMatch(html, /A contractual sentence only the tender should carry\./);
  assert.doesNotMatch(html, /<th>Category<\/th>/);
});

test("the offer still prints what it sells and what it excludes", () => {
  const snapshot = snapshotWithSchedule([{ spec: "S", category: "C" }]);
  const html = buildProposalHtml(
    buildProposalInput({
      ...snapshot,
      draft: { ...snapshot.draft, inclusionHighlights: ["40mm stone benchtops throughout"] },
    } as OfferWorkspaceSnapshot),
    EMPTY_OFFER_IMAGES,
  );

  assert.match(html, /This price includes/);
  assert.match(html, /40mm stone benchtops throughout/);
  assert.match(html, /This price excludes/);
});

test("the tender carries the full schedule with its Category column", () => {
  const html = buildTenderHtml(
    buildProposalInput(
      snapshotWithSchedule([
        { spec: "Full AS3740 waterproofing.", category: "Waterproofing" },
      ]),
    ),
  );

  assert.match(html, /Full AS3740 waterproofing\./);
  assert.match(html, /<th>Category<\/th>/);
  assert.match(html, /Waterproofing/);
});

test("an uncategorised row still prints Miscellaneous on the tender", () => {
  const html = buildTenderHtml(
    buildProposalInput(snapshotWithSchedule([{ spec: "No category here." }])),
  );

  assert.match(html, new RegExp(UNCATEGORISED_INCLUSION_LABEL));
});

test("an empty schedule renders no inclusions page on the tender", () => {
  const html = buildTenderHtml(buildProposalInput(snapshotWithSchedule([])));

  assert.doesNotMatch(html, /Scope of Works/);
});
