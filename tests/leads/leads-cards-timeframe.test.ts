import assert from "node:assert/strict";
import { test } from "vitest";
import { LeadStage as DBLeadStage } from "@prisma/client";

import { createdRangeFor, previousMonthRange } from "@/lib/leads/created-range";
import { emptyLeadsMessage } from "@/lib/leads/empty-state";
import {
  countLeadsWithoutValue,
  sumValueInStages,
} from "@/lib/leads/pipeline-math";
import { CLOSED_LEAD_STAGES } from "@/lib/leads/followup-due";
import { isKpiCohortMetric } from "@/lib/leads/lead-helpers";
import {
  OFFER_OUT_DB_STAGES,
  OFFER_OUT_STAGE_LABELS,
  LeadStageToLeadStageDBMapping,
  OPEN_LEAD_DB_STAGES,
  OPEN_LEAD_STAGE_LABELS,
  parseLeadStageFilter,
} from "@/lib/leads/types";
import { readLeadsListParams } from "@/components/leads/leads-list-url";

// Monday 16 Nov 2026, 4pm in Sydney (AEDT, UTC+11).
const NOW = new Date("2026-11-16T05:00:00.000Z");
const iso = (range: { gte: Date; lte: Date } | null) =>
  range && [range.gte.toISOString(), range.lte.toISOString()];

test('"created in" is a Sydney calendar period, Monday-first weeks, and null for all time', () => {
  assert.equal(createdRangeFor(undefined, NOW), null);
  assert.equal(createdRangeFor("all", NOW), null);
  assert.deepEqual(iso(createdRangeFor("today", NOW)), [
    "2026-11-15T13:00:00.000Z",
    "2026-11-16T12:59:59.999Z",
  ]);
  assert.deepEqual(iso(createdRangeFor("this_week", NOW)), [
    "2026-11-15T13:00:00.000Z",
    "2026-11-22T12:59:59.999Z",
  ]);
  assert.deepEqual(iso(createdRangeFor("this_month", NOW)), [
    "2026-10-31T13:00:00.000Z",
    "2026-11-30T12:59:59.999Z",
  ]);
  // The quarter starts on 1 Oct, before daylight saving does (UTC+10 then).
  assert.deepEqual(iso(createdRangeFor("quarter", NOW)), [
    "2026-09-30T14:00:00.000Z",
    "2026-12-31T12:59:59.999Z",
  ]);
  assert.deepEqual(iso(createdRangeFor("this_year", NOW)), [
    "2025-12-31T13:00:00.000Z",
    "2026-12-31T12:59:59.999Z",
  ]);
});

test("an unknown timeframe is read as today, as the table always has", () => {
  assert.deepEqual(
    iso(createdRangeFor("fortnight", NOW)),
    iso(createdRangeFor("today", NOW)),
  );
});

test("Open leads is every stage that is not closed, and the card and its click use the same list", () => {
  const closed = new Set<DBLeadStage>(CLOSED_LEAD_STAGES);
  const expected = Object.values(DBLeadStage).filter((s) => !closed.has(s));
  assert.deepEqual([...OPEN_LEAD_DB_STAGES].sort(), [...expected].sort());
  // Stalled leads are still live work; only won/lost/cancelled/disqualified are out.
  assert.ok(OPEN_LEAD_DB_STAGES.includes(DBLeadStage.NO_RESPONSE));
  assert.ok(!OPEN_LEAD_DB_STAGES.includes(DBLeadStage.LOST));
  assert.ok(!OPEN_LEAD_DB_STAGES.includes(DBLeadStage.CONVERTED));

  // The click sends these labels to the server, which resolves them to stages.
  const { stages, unknown } = parseLeadStageFilter(
    OPEN_LEAD_STAGE_LABELS.join(","),
  );
  assert.deepEqual(unknown, []);
  assert.deepEqual([...stages].sort(), [...OPEN_LEAD_DB_STAGES].sort());
});

test("every database stage has a filter label, so no open stage can be missed by the click", () => {
  assert.deepEqual(
    Object.values(LeadStageToLeadStageDBMapping).sort(),
    Object.values(DBLeadStage).sort(),
  );
});

test("?status=open survives the URL reader and is a whole-token cohort metric", () => {
  assert.equal(
    readLeadsListParams(new URLSearchParams("status=open")).status,
    "open",
  );
  assert.ok(isKpiCohortMetric("open"));
  // A chip label that merely contains a keyword is not a cohort.
  assert.ok(!isKpiCohortMetric("Lost"));
  assert.ok(!isKpiCohortMetric("Lost,Disqualified"));
});

test("an empty list names what is narrowing it", () => {
  assert.equal(
    emptyLeadsMessage({ hasSearch: true, hasFilters: false }),
    "No leads match your search.",
  );
  assert.equal(
    emptyLeadsMessage({ hasSearch: false, hasFilters: true }),
    "No leads match these filters.",
  );
  assert.equal(
    emptyLeadsMessage({ hasSearch: true, hasFilters: true }),
    "No leads match your search and filters.",
  );
  assert.equal(
    emptyLeadsMessage({ hasSearch: false, hasFilters: false }),
    "There are no leads yet.",
  );
});

test("open leads without a value: empty, unusable and zero all count; closed leads and valued ones do not", () => {
  const lead = (stage: string, estimatedValue: string | null) =>
    ({
      id: 1,
      stage,
      estimatedValue,
      probabilityOverride: null,
      expectedCloseDate: null,
      wonAt: null,
      lostAt: null,
    }) as unknown as Parameters<typeof countLeadsWithoutValue>[0][number];
  const open = new Set(OPEN_LEAD_DB_STAGES);
  assert.equal(
    countLeadsWithoutValue(
      [
        lead("NEW", null), // nothing entered
        lead("QUOTED", ""), // blank
        lead("NO_RESPONSE", "abc"), // unusable
        lead("CONTACTED", "0"), // a $0 estimate adds nothing
        lead("QUALIFIED", "250000"), // has a value
        lead("LOST", null), // closed: not an open lead
        lead("CONVERTED", null), // closed
      ],
      open,
    ),
    4,
  );
});

test("last month is the Sydney calendar month before this one, across the daylight-saving change", () => {
  // Now is in November (AEDT, UTC+11); October began on AEST (UTC+10).
  assert.deepEqual(iso(previousMonthRange(NOW)), [
    "2026-09-30T14:00:00.000Z",
    "2026-10-31T12:59:59.999Z",
  ]);
  // Early on the 1st in Sydney is still the 31st in UTC, and still this month.
  assert.deepEqual(
    iso(previousMonthRange(new Date("2026-10-31T13:30:00.000Z"))),
    iso(previousMonthRange(NOW)),
  );
});

test("offers-out value adds the leads in Quoted and Negotiating only, ignoring missing values", () => {
  const lead = (stage: string, estimatedValue: string | null) =>
    ({
      id: 1,
      stage,
      estimatedValue,
      probabilityOverride: null,
      expectedCloseDate: null,
      wonAt: null,
      lostAt: null,
    }) as unknown as Parameters<typeof sumValueInStages>[0][number];
  const total = sumValueInStages(
    [
      lead("QUOTED", "600000"),
      lead("NEGOTIATING", "715000.50"),
      lead("QUOTED", null),
      lead("DISCOVERY", "900000"),
      lead("CONVERTED", "500000"),
    ],
    new Set(["QUOTED", "NEGOTIATING"] as const),
  );
  assert.equal(total.toString(), "1315000.5");
});

test("Offers out: the card's stages and its click's labels are one list (Quoted, Negotiating)", () => {
  const { stages, unknown } = parseLeadStageFilter(
    OFFER_OUT_STAGE_LABELS.join(","),
  );
  assert.deepEqual(unknown, []);
  assert.deepEqual([...stages].sort(), [...OFFER_OUT_DB_STAGES].sort());
  assert.deepEqual([...OFFER_OUT_DB_STAGES].sort(), ["NEGOTIATING", "QUOTED"]);
  // The URL reader keeps the comma list, so the click survives a reload.
  assert.equal(
    readLeadsListParams(
      new URLSearchParams(`status=${OFFER_OUT_STAGE_LABELS.join(",")}`),
    ).status,
    "Quoted,Negotiating",
  );
});
