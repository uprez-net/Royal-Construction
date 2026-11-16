import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import {
  FOLLOWUP_TASK_TYPES,
  NEXT_FOLLOWUP_TASK,
  resolveFollowup,
} from "@/lib/leads/followup-resolution";
import { leadFollowup } from "@/lib/leads/followup-due";
import {
  dropEmptyPlaceholders,
  hydrateVariable,
} from "@/lib/leads/lead-helpers";
import { EMAIL_TEMPLATES } from "@/lib/leads/variables";
import type { Lead } from "@/lib/leads/types";

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

test("the include filters to follow-up TYPES but NOT to open work", () => {
  // The entire fix depends on a completed task surviving the query. Filtering
  // it out is what made "done" and "never had one" the same empty array. The
  // type filter is the other half (#316): a booked meeting is not a follow-up.
  assert.deepEqual(NEXT_FOLLOWUP_TASK.where, {
    type: { in: ["CALL", "EMAIL", "WHATSAPP"] },
  });
  assert.ok(
    !("completedAt" in NEXT_FOLLOWUP_TASK.where),
    "the include filters to open work again, so a completed task is invisible",
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
  // Every lead read and write shares LEAD_ROW_INCLUDE (lib/domain/leads/
  // row-read.ts): the writes load it through Prisma, the reads through the SQL
  // beside it. A read in the adapter that wrote its own include could drop the
  // task silently, so the adapter may not have one.
  const adapter = code("lib/data/leads.ts");
  const rowRead = code("lib/domain/leads/row-read.ts");
  const command = code("lib/domain/leads/commands.ts");

  const mapLeadCalls = (adapter.match(/mapLead\(/g) ?? []).length;
  assert.ok(mapLeadCalls >= 7, `only ${mapLeadCalls} mapLead call sites found`);
  assert.doesNotMatch(
    adapter,
    /prisma\.lead\.find(Many|Unique|First)\(\{[^}]*include:/,
    "a lead read in the adapter has its own include again",
  );
  assert.ok(
    (adapter.match(/readLeadRows\(/g) ?? []).length >= 4,
    "a lead read in the adapter no longer goes through readLeadRows",
  );

  // The one include names the task, and the SQL loads it in the same order.
  assert.match(rowRead, /tasks: NEXT_FOLLOWUP_TASK/);
  // ...and the SQL reads the same types from the same constant, not a copy.
  assert.match(
    rowRead,
    /lt\.type::text IN \(\$\{Prisma\.join\(\[\.\.\.FOLLOWUP_TASK_TYPES\]\)\}\)/,
  );
  assert.match(rowRead, /_count: \{ select: \{ tasks: true \} \}/);
  assert.match(rowRead, /'_count', jsonb_build_object\('tasks'/);
  assert.match(
    rowRead,
    /ORDER BY lt\."completedAt" ASC NULLS FIRST, lt\."dueDate" ASC NULLS LAST, lt\.id ASC\s+LIMIT 1/,
    "the SQL no longer picks the task NEXT_FOLLOWUP_TASK picks",
  );
  assert.equal(
    (command.match(/include: LEAD_ROW_INCLUDE/g) ?? []).length,
    3,
    "a lead write is reading relations without the task include",
  );
});

// ── #316: a meeting is not a follow-up, a closed lead has none ──

test("a lead whose only tasks are meetings or holds has no follow-up, not the stale column", () => {
  // The follow-up list is empty (the query only returns follow-up types) but
  // the lead has a task, so the retired column is not consulted.
  const r = resolveFollowup([], LEGACY, "08:30", 1);
  assert.deepEqual(r, { date: null, time: null });
});

test("the retired column is still the answer for a lead that never had any task", () => {
  assert.deepEqual(resolveFollowup([], LEGACY, "08:30", 0), {
    date: LEGACY,
    time: "08:30",
  });
});

test("the follow-up types are the client-facing channels, never a meeting or a hold", () => {
  assert.deepEqual([...FOLLOWUP_TASK_TYPES], ["CALL", "EMAIL", "WHATSAPP"]);
});

test("mapLead resolves the follow-up through leadFollowup, with the task count", () => {
  const source = code("types/lead.ts");
  assert.match(source, /leadFollowup\(\{/);
  assert.match(source, /taskCount:\s*lead\._count\.tasks/);
});

test("a closed lead advertises no follow-up, and an open one resolves from its tasks", () => {
  const open = { date: DUE, time: "09:50" };
  const task = [{ dueDate: DUE, dueTime: "09:50", completedAt: null }];
  const base = {
    tasks: task,
    taskCount: 1,
    legacyDate: LEGACY,
    legacyTime: "08:30",
  };
  assert.deepEqual(leadFollowup({ ...base, stage: "NEGOTIATING" }), open);
  for (const stage of [
    "CONVERTED",
    "WON",
    "LOST",
    "CANCELLED",
    "DISQUALIFIED",
  ]) {
    assert.deepEqual(
      leadFollowup({ ...base, stage }),
      { date: null, time: null },
      stage,
    );
  }
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
  assert.ok(source.includes("leadFollowup("));
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
    meetingDate: null,
    meetingTime: null,
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

test("a real booked consultation renders in the Meeting subject", () => {
  const meetingSubject = EMAIL_TEMPLATES.find((t) => t.id === 7)?.subject;
  assert.equal(
    hydrateVariable(
      meetingSubject!,
      lead({ meetingDate: "2026-09-25", meetingTime: "09:50" }),
    ),
    "Site visit for Jane Nguyen - Kellyville on 25 Sep 2026 09:50",
  );
});

test("the Meeting subject quotes the consultation, never the follow-up", () => {
  // These are two different appointments. The subject used to read {followup}
  // while the body underneath confirmed the site visit, so one email could
  // name two different dates.
  const meetingSubject = EMAIL_TEMPLATES.find((t) => t.id === 7)?.subject;
  assert.ok(
    meetingSubject!.includes("{meeting}")
      && !meetingSubject!.includes("{followup}"),
    "the Meeting subject is back on the follow-up date",
  );

  const rendered = hydrateVariable(
    meetingSubject!,
    lead({
      followupDate: "2026-12-01",
      followupTime: "08:00",
      meetingDate: "2026-09-25",
      meetingTime: "09:50",
    }),
  );
  assert.ok(rendered.includes("25 Sep 2026"), "the consultation is missing");
  assert.ok(!rendered.includes("1 Dec 2026"), "the follow-up leaked in");
});

test("a lead with a follow-up but no consultation gets no date in the Meeting subject", () => {
  const meetingSubject = EMAIL_TEMPLATES.find((t) => t.id === 7)?.subject;
  assert.equal(
    hydrateVariable(
      meetingSubject!,
      lead({ followupDate: "2026-12-01", followupTime: "08:00" }),
    ),
    "Site visit for Jane Nguyen - Kellyville",
  );
});

test("an unparsable stored date is dropped, not printed", () => {
  // formatFollowup returns "" for a truthy-but-invalid date, which used to
  // leave the subject ending in a bare "on ".
  const meetingSubject = EMAIL_TEMPLATES.find((t) => t.id === 7)?.subject;
  const rendered = hydrateVariable(
    meetingSubject!,
    lead({ meetingDate: "not a date" }),
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
  assert.ok(
    source.includes("date={meetingDate ?? undefined}"),
    "the site-visit email is not using the booked consultation date",
  );
  assert.ok(
    source.includes("time={lead?.meetingTime ?? undefined}"),
    "the site-visit email is not using the booked consultation time",
  );
  // The follow-up pair is a different appointment and must not reach it.
  // Scoped to the element itself: `followupDate` is legitimately declared and
  // used elsewhere in this module, including in the snapshot card.
  const element = /<SiteVisitEmail[\s\S]*?\/>/.exec(source)?.[0];
  assert.ok(element, "the site-visit element moved or was renamed");
  assert.ok(
    !/followup/i.test(element),
    `the follow-up date is still reaching the site-visit email: ${element}`,
  );
});

test("LeadPreview carries the meeting pair, or the email cannot see it", () => {
  const source = read("lib/leads/render-email-html.tsx");
  assert.ok(
    /meetingDate\?: string \| null;/.test(source)
      && /meetingTime\?: string \| null;/.test(source),
    "renderEmailHtml cannot receive the booked consultation",
  );
});

test("SiteVisitEmail still has its own empty state to fall back on", () => {
  const source = read("lib/graph/Email/site-visit-email.tsx");
  assert.ok(
    /date = "TBD"/.test(source) && /time = "TBD"/.test(source),
    "passing undefined now renders blank rather than TBD",
  );
});

test("the SQL lead read keeps Prisma's _count, which it would otherwise drop as an unknown key", async () => {
  // reviveRow drops keys the model does not have. `_count` is not a field but
  // it is part of what Prisma returns for `include: { _count }`, and without it
  // a lead read through SQL has no task count: resolveFollowup would read
  // undefined. scripts/perf/compare-lead-read.ts found it on real rows; this
  // pins it without a database.
  const { reviveRow } = await import("@/lib/domain/sql-json");
  const row = reviveRow(
    { id: 7, name: "x", _count: { tasks: 2 }, notAColumn: 1 },
    "Lead",
  ) as Record<string, unknown>;
  assert.deepEqual(row._count, { tasks: 2 });
  assert.equal("notAColumn" in row, false);
});
