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
  getOfferDocumentExclusions,
  getVisibleExclusionRows,
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
import {
  buildInclusionSections,
  buildTenderHtml,
  INCLUSION_SECTION_ORDER,
  OTHER_INCLUSIONS_SECTION,
} from "../../lib/offer/offer-tender-html";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";

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

test("the offer document uses only the exclusions set in the Offer phase", () => {
  const draft = {
    ...INITIAL_OFFER_DRAFT,
    exclusionBullets: ["Client-facing exclusion"],
  };
  const scopeItem = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-not-on-offer",
    label: "Removed from the Offer document",
    includedInOfferDocument: true,
  };

  assert.deepEqual(getOfferDocumentExclusions(draft), ["Client-facing exclusion"]);
  assert.deepEqual(
    buildOfferPrintTemplateData(
      buildProposalInput({
        ...snapshotWithSchedule([]),
        draft,
        exclusions: [scopeItem],
      } as OfferWorkspaceSnapshot),
    ).exclusionBullets,
    ["Client-facing exclusion"],
  );
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
    adminContentVersion: 0,
    calcVersion: LEGACY_CALC_VERSION,
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

// The tender now follows the Word template: three columns (Ref / Description /
// Status), the entry's trade label as the Description cell's bold lead-in, and a
// hierarchical {section}.{row} reference. The Category COLUMN is gone — the
// category is a per-row trade label, not a section, so it moved into the cell.
// ─── Tender section grouping (D11) ───────────────────────────────────────────
// `category` is a per-ROW trade label, not a section, so the tender maps each
// label onto one of the template's canonical sections. These cases pin the
// ordering rules; a mis-ordered or mis-filed section misstates which part of the
// contract carries a row.

test("sections follow the template's canonical order, not first appearance", () => {
  // Deliberately supplied in reverse canonical order.
  const sections = buildInclusionSections([
    { spec: "Council fees", category: "Approvals" },
    { spec: "Slab", category: "Concrete Slab" },
    { spec: "Drawings", category: "Design & Plans" },
  ]);

  assert.deepEqual(
    sections.map((section) => section.name),
    [...INCLUSION_SECTION_ORDER],
    "canonical order must not depend on the order entries were entered",
  );
  assert.deepEqual(
    sections.map((section) => section.index),
    [1, 2, 3],
    "section numbers are 1-based and contiguous",
  );
  assert.deepEqual(
    sections.flatMap((section) => section.rows.map((row) => row.ref)),
    ["1.1", "2.1", "3.1"],
    "refs are {section}.{row}, both 1-based",
  );
});

test("an unmapped or missing category falls into Other Inclusions, last", () => {
  const sections = buildInclusionSections([
    { spec: "Estimator wrote this" },
    { spec: "Bespoke item", category: "Something Nobody Mapped" },
    { spec: "Slab", category: "Concrete Slab" },
  ]);

  assert.deepEqual(sections.map((section) => section.name), [
    "Building",
    OTHER_INCLUSIONS_SECTION,
  ]);
  const other = sections[sections.length - 1];
  assert.equal(other.name, OTHER_INCLUSIONS_SECTION, "Other Inclusions is last");
  assert.deepEqual(
    other.rows.map((row) => row.ref),
    ["2.1", "2.2"],
    "both the uncategorised and the unmapped row land in Other Inclusions",
  );
  // The unmapped row keeps its label as the description lead-in.
  assert.equal(other.rows[1].label, "Something Nobody Mapped");
  assert.equal(other.rows[0].label, "", "an absent category yields no label");
});

test("a section holding exactly one entry still renders as a section", () => {
  const sections = buildInclusionSections([
    { spec: "Council fees", category: "Approvals" },
  ]);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "Council & Statutory Authority Requirements");
  assert.equal(sections[0].index, 1, "a lone section is numbered 1, not 3");
  assert.deepEqual(sections[0].rows.map((row) => row.ref), ["1.1"]);
});

test("an empty schedule renders zero sections, not an empty table", () => {
  assert.deepEqual(buildInclusionSections([]), []);

  const html = buildTenderHtml(buildProposalInput(snapshotWithSchedule([])));
  assert.doesNotMatch(html, /<th class="c-ref">Ref<\/th>/, "no headless table");
  assert.doesNotMatch(
    html,
    /class="t-section">\d+\.&nbsp;&nbsp;&nbsp;(Fixed Price|Building|Council|Other)/,
    "no inclusion section heading",
  );
  // Contract Terms continues the schedule's numbering, so with zero inclusion
  // sections it becomes section 1 rather than leaving a gap.
  assert.match(html, /class="t-section">1\.&nbsp;&nbsp;&nbsp;Contract Terms/);
});

test("label matching ignores case, dash style and repeated whitespace", () => {
  for (const label of [
    "Rendering — Full Facade",
    "rendering - full facade",
    "RENDERING  –  FULL   FACADE",
  ]) {
    const sections = buildInclusionSections([{ spec: "Render", category: label }]);
    assert.equal(
      sections[0].name,
      "Building",
      `"${label}" should resolve to Building`,
    );
  }
});

test("the tender prints a three-column schedule with hierarchical refs", () => {
  const html = buildTenderHtml(
    buildProposalInput(
      snapshotWithSchedule([{ spec: "Tender spec", category: "Tiling" }]),
    ),
  );

  assert.match(html, /Tender spec/);
  assert.match(html, /<th class="c-ref">Ref<\/th>/);
  assert.match(html, /<th class="c-desc">Description<\/th>/);
  assert.match(html, /<th class="c-status">Status<\/th>/);
  assert.doesNotMatch(html, /<th[^>]*>Category<\/th>/, "the Category column is gone");
  // The trade label leads the description cell in bold, above its detail.
  assert.match(html, /<b>Tiling<\/b><br \/>Tender spec/);
  // "Tiling" maps to the Building section. It is the only entry here, so
  // Building is the only section rendered and its single row is 1.1.
  assert.match(html, /<td class="c-ref">1\.1<\/td>/);
  assert.match(html, /1\.&nbsp;&nbsp;&nbsp;Building/);
});

// An entry pulled from the cost schedule or typed by an estimator has no
// category. It must never print an empty cell on a fixed-price contract.
// The OFFER still prints the Miscellaneous label in its Category column. The
// TENDER has no such column: an uncategorised entry falls into the final "Other
// Inclusions" section instead, so it is still visibly classified rather than
// printing an empty cell on a fixed-price contract.
test("an entry with no category is still classified on both documents", () => {
  const snapshot = snapshotWithSchedule([{ spec: "Pulled from cost schedule." }]);

  const offer = buildProposalHtml(buildProposalInput(snapshot), EMPTY_OFFER_IMAGES);
  const tender = buildTenderHtml(buildProposalInput(snapshot));

  assert.match(offer, new RegExp(UNCATEGORISED_INCLUSION_LABEL));
  assert.match(tender, new RegExp(OTHER_INCLUSIONS_SECTION));
  assert.match(tender, /Pulled from cost schedule\./);
  // No empty bold label where the trade label would have been: the cell is the
  // spec alone, not a stray "<b></b>" followed by the detail.
  assert.doesNotMatch(tender, /<td class="c-desc"><b><\/b>/);
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

  assert.equal(migrated.schemaVersion, CURRENT_WORKSPACE_SCHEMA_VERSION);
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

  // Refs are hierarchical now. None of these "Cat N" labels is a known trade
  // label, so all 60 land in the single "Other Inclusions" section and run
  // 1.1..1.60 — unbroken, and never restarting at a page boundary.
  const refs = [...html.matchAll(/<td class="c-ref">([\d.]+)<\/td>/g)].map(
    (m) => m[1],
  );
  assert.equal(refs.length, 60, "every inclusion should be numbered once");
  assert.deepEqual(
    refs,
    Array.from({ length: 60 }, (_, i) => `1.${i + 1}`),
    "refs must run 1.1..1.60 unbroken across page breaks",
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

// ─── Exclusion detail reaches the tender ───

// The Scope step captures `description` and `variationRule` on every exclusion,
// and getVisibleExclusions took only `.label` — so an estimator typed "Can be
// priced later as a written variation" and no client ever saw it.
test("a scope exclusion carries its detail through to print", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: [] };
  const item = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-1",
    label: "Pool, spa and water features",
    description: "Can be priced later as a separate package.",
    variationRule: "Priced as a written variation.",
    includedInOfferDocument: true,
  };

  assert.deepEqual(getVisibleExclusionRows(draft, [item]), [
    {
      label: "Pool, spa and water features",
      description: "Can be priced later as a separate package.",
      variationRule: "Priced as a written variation.",
    },
  ]);
});

// A free-text bullet has no detail to carry. Printing it blank is honest;
// inventing a description for it would be text nobody wrote.
test("a free-text bullet prints label-only, with nothing invented", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: ["Boundary fencing"] };

  assert.deepEqual(getVisibleExclusionRows(draft, []), [
    { label: "Boundary fencing", description: "", variationRule: "" },
  ]);
});

test("a scope item's detail wins over a bare bullet of the same label", () => {
  const draft = { ...INITIAL_OFFER_DRAFT, exclusionBullets: ["Swimming pool or spa"] };
  const item = {
    ...INITIAL_EXCLUSIONS[0],
    id: "scope-2",
    label: "Swimming pool or spa",
    description: "Not in the building scope.",
    variationRule: "Separate contract.",
    includedInOfferDocument: true,
  };
  const rows = getVisibleExclusionRows(draft, [item]);

  assert.equal(rows.length, 1, "the label must not print twice");
  assert.equal(rows[0].description, "Not in the building scope.");
});

test("the tender prints Scope exclusion detail; the offer uses its short list", () => {
  const snapshot = snapshotWithSchedule([{ spec: "S", category: "C" }]);
  const withDetail = {
    ...snapshot,
    exclusions: [
      {
        ...INITIAL_EXCLUSIONS[0],
        id: "x",
        label: "Pool and spa",
        description: "Priced separately on request.",
        variationRule: "Written variation only.",
        includedInOfferDocument: true,
      },
    ],
    draft: { ...snapshot.draft, exclusionBullets: [] },
  } as OfferWorkspaceSnapshot;

  const tender = buildTenderHtml(buildProposalInput(withDetail));
  const offer = buildProposalHtml(buildProposalInput(withDetail), EMPTY_OFFER_IMAGES);

  assert.match(tender, /Priced separately on request\./);
  assert.match(tender, /<th>What this means<\/th>/);
  assert.doesNotMatch(
    offer,
    /Pool and spa/,
    "a Scope exclusion must not repopulate the Offer list",
  );
  assert.doesNotMatch(
    offer,
    /Priced separately on request\./,
    "the offer sells; the tender carries the obligation",
  );
});
