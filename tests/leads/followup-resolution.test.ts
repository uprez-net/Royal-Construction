import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  NEXT_FOLLOWUP_TASK,
  resolveFollowup,
} from "../../lib/leads/followup-resolution";
import {
  dropEmptyPlaceholders,
  hydrateVariable,
} from "../../lib/leads/lead-helpers";
import { EMAIL_TEMPLATES } from "../../lib/leads/variables";
import type { Lead } from "../../lib/leads/types";

// A completed follow-up used to keep its date forever. `mapLead` resolved
// task-first, column-second, and every query asked only for OPEN tasks — so a
// completed one came back as [] and fell through to Lead.followupDate, a
// column nothing ever clears (its companion followupCompletedAt has one writer,
// behind an input no UI sends, and is null on every lead in the database).
//
// The client was then told, by email, that their next follow-up was a date
// months in the past. On staging: 14 leads, 6 to 222 days stale.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DUE = new Date("2026-09-25T04:00:00.000Z");
const CLOSED = new Date("2026-09-20T01:00:00.000Z");
const LEGACY = new Date("2026-04-09T08:30:00.000Z");

// ── The three states ──

test("an open task decides the follow-up, not the column", () => {
  const r = resolveFollowup(
    [{ dueDate: DUE, dueTime: "09:50", completedAt: null }],
    LEGACY,
    "08:30",
  );
  assert.equal(r.date, DUE);
  assert.equal(r.time, "09:50");
});

test("a completed task means there is NO upcoming follow-up", () => {
  // The bug. This used to return LEGACY, and that date went to the client.
  const r = resolveFollowup(
    [{ dueDate: DUE, dueTime: "09:50", completedAt: CLOSED }],
    LEGACY,
    "08:30",
  );
  assert.equal(r.date, null, "the completed task's date came back as upcoming");
  assert.equal(r.time, null);
});

test("a lead that never had a task still gets the legacy column", () => {
  // Kept deliberately: staging has nobody in this state, but the column
  // predates the task table and production is not staging.
  const r = resolveFollowup([], LEGACY, "08:30");
  assert.equal(r.date, LEGACY);
  assert.equal(r.time, "08:30");
});

test("an open task with no due date shows nothing, never the stale column", () => {
  // Real work deliberately left unscheduled. Falling back here would print a
  // legacy date over a live task.
  const r = resolveFollowup(
    [{ dueDate: null, dueTime: null, completedAt: null }],
    LEGACY,
    "08:30",
  );
  assert.equal(r.date, null);
  assert.equal(r.time, null);
});

test("a lead with no task and no column has no follow-up", () => {
  assert.deepEqual(resolveFollowup([], null, null), { date: null, time: null });
});

// ── The query that makes the three states distinguishable ──

test("the include does NOT filter to open work", () => {
  // The entire fix depends on a completed task surviving the query. Filtering
  // it out is what made "done" and "never had one" the same empty array.
  assert.ok(
    !("where" in NEXT_FOLLOWUP_TASK),
    "the include filters again, so a completed task is invisible",
  );
  assert.equal(NEXT_FOLLOWUP_TASK.take, 1);
  assert.equal(NEXT_FOLLOWUP_TASK.select.completedAt, true);
});

test("open work sorts ahead of closed work, so take:1 finds it", () => {
  const [first] = NEXT_FOLLOWUP_TASK.orderBy;
  assert.deepEqual(
    first,
    { completedAt: { sort: "asc", nulls: "first" } },
    "a lead with both an open and a completed task would report the closed one",
  );
});

// ── Every query site loads it ──

test("no query feeding mapLead omits the task", () => {
  const source = code("lib/data/leads.ts");
  const mapLeadCalls = (source.match(/mapLead\(/g) ?? []).length;
  const includes = (source.match(/tasks: NEXT_FOLLOWUP_TASK/g) ?? []).length;

  // 7 mapLead call sites, 6 distinct queries — two create paths share one
  // include constant.
  assert.ok(mapLeadCalls >= 7, `only ${mapLeadCalls} mapLead call sites found`);
  assert.equal(includes, 6, `expected 6 include sites, found ${includes}`);
});

test("the tasks field is required, which is what forces the include", () => {
  const source = read("types/lead.ts");
  assert.ok(
    !/tasks\?:/.test(source),
    "tasks is optional again — a query can silently skip it and get the stale column",
  );
  assert.ok(source.includes("tasks: NextFollowupTask[]"));
});

test("mapLead no longer reads the retired columns directly", () => {
  const source = code("types/lead.ts");
  assert.ok(
    !/lead\.tasks && lead\.tasks\.length > 0/.test(source),
    "the old task-first/column-second ternary is back",
  );
  assert.ok(source.includes("resolveFollowup("));
});

// ── What the client is told ──

const lead = (over: Partial<Lead> = {}): Lead =>
  ({
    name: "Jane Nguyen",
    type: "Duplex",
    location: "Kellyville",
    phone: "0400 000 000",
    budget: "Not Discussed",
    stage: "Discovery",
    source: "Website",
    sourceDetail: "",
    notes: "",
    followupDate: null,
    followupTime: null,
    ...over,
  }) as unknown as Lead;

test("no follow-up drops the date clause instead of inventing filler", () => {
  // Was: "... - next step". A noun phrase in a slot the reader reads as a date.
  const followUpSubject = EMAIL_TEMPLATES.find((t) => t.id === 3)?.subject;
  assert.ok(followUpSubject, "the Follow-up template moved");

  assert.equal(
    hydrateVariable(followUpSubject, lead()),
    "Following up on your Duplex in Kellyville",
  );
});

test("the Meeting subject does not end on a dangling preposition", () => {
  // Was: "Site visit for Jane Nguyen - Kellyville on next step".
  // Naive emptying gives: "... Kellyville on " — the connector has to go too.
  const meetingSubject = EMAIL_TEMPLATES.find((t) => t.id === 7)?.subject;
  assert.ok(meetingSubject, "the Meeting template moved");

  const rendered = hydrateVariable(meetingSubject, lead());
  assert.equal(rendered, "Site visit for Jane Nguyen - Kellyville");
  assert.ok(!/\bon\s*$/.test(rendered));
  assert.ok(!rendered.includes("next step"));
});

test("a real follow-up still renders in the subject", () => {
  const meetingSubject = EMAIL_TEMPLATES.find((t) => t.id === 7)?.subject;
  assert.equal(
    hydrateVariable(
      meetingSubject!,
      lead({ followupDate: "2026-09-25", followupTime: "09:50" }),
    ),
    "Site visit for Jane Nguyen - Kellyville on 25 Sep 2026 09:50",
  );
});

test("an unparsable stored date is dropped, not printed", () => {
  // formatFollowup returns "" for a truthy-but-invalid date, which used to
  // leave the subject ending in a bare "on ".
  const meetingSubject = EMAIL_TEMPLATES.find((t) => t.id === 7)?.subject;
  const rendered = hydrateVariable(
    meetingSubject!,
    lead({ followupDate: "not a date" }),
  );
  assert.equal(rendered, "Site visit for Jane Nguyen - Kellyville");
});

// ── The connector stripper ──

test("the placeholder takes its connector with it", () => {
  assert.equal(dropEmptyPlaceholders("a - {followup}", ["followup"]), "a");
  assert.equal(dropEmptyPlaceholders("a on {followup}", ["followup"]), "a");
  assert.equal(dropEmptyPlaceholders("a at {time}", ["time"]), "a");
  assert.equal(dropEmptyPlaceholders("a, {followup}", ["followup"]), "a");
});

test("a placeholder mid-sentence does not leave a double space", () => {
  assert.equal(dropEmptyPlaceholders("a {followup} b", ["followup"]), "a b");
});

test("placeholders that still have a value are untouched", () => {
  assert.equal(
    dropEmptyPlaceholders("Site visit for {name} on {followup}", ["followup"]),
    "Site visit for {name}",
  );
});

test("a word ending in a connector is not mistaken for one", () => {
  // \b guards this: "bacon" must not lose its tail.
  assert.equal(
    dropEmptyPlaceholders("bacon {followup}", ["followup"]),
    "bacon",
  );
});

// ── The Meeting email body ──

test("the Meeting template no longer invents a date and time", () => {
  const source = code("lib/leads/render-email-html.tsx");

  assert.ok(
    !source.includes("followupDate ?? today"),
    "the site-visit email defaults to today again — it claims a visit nobody booked",
  );
  assert.ok(
    !source.includes('"10:00 AM"'),
    "the site-visit email invents a time again",
  );
  assert.ok(source.includes("date={followupDate ?? undefined}"));
});

test("SiteVisitEmail still has its own empty state to fall back on", () => {
  const source = read("lib/graph/Email/site-visit-email.tsx");
  assert.ok(
    /date = "TBD"/.test(source) && /time = "TBD"/.test(source),
    "passing undefined now renders blank rather than TBD",
  );
});
