import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { dropAlreadyRecorded } from "@/lib/leads/lead-history";
import { sydneyWallClockToInstant } from "@/lib/dates/sydney";
import { buildStageChangedHistoryEntry } from "@/lib/leads/lead-helpers";

// One booking took lead #105 from four activity entries to nine. Two callers
// handed `updateLead` the lead's whole history back, every row was inserted a
// second time, and the copies landed ten hours late because a stored instant
// had been re-encoded as a Sydney wall clock and then read as UTC.
//
// updateLead itself needs a database, so the seams are tested directly and the
// two callers are pinned against their source.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const entry = (
  action: string,
  detail: string,
  actionDate: Date,
): { action: string; detail: string; actionDate: Date } => ({
  action,
  detail,
  actionDate,
});

test("an entry already on the lead is not inserted again", () => {
  const existing = [
    entry(
      "Lead created",
      "Lead manually created",
      new Date("2026-09-17T22:32:00Z"),
    ),
    entry(
      "Email sent",
      "Subject: Following up",
      new Date("2026-09-17T08:35:00Z"),
    ),
  ];

  const kept = dropAlreadyRecorded(
    [
      ...existing,
      entry(
        "NOTE",
        "Appointment: 22 September",
        new Date("2026-09-18T08:56:00Z"),
      ),
    ],
    existing,
  );

  assert.deepEqual(
    kept.map((e) => e.action),
    ["NOTE"],
  );
});

test("the whole history echoed back inserts nothing", () => {
  const existing = [
    entry(
      "Lead created",
      "Lead manually created",
      new Date("2026-09-17T22:32:00Z"),
    ),
    entry(
      "Lead note saved",
      "Knockdown rebuild",
      new Date("2026-09-17T08:46:00Z"),
    ),
  ];

  assert.deepEqual(dropAlreadyRecorded(existing, existing), []);
});

test("duplicates inside one call collapse to a single row", () => {
  const same = entry(
    "Email sent",
    "Subject: Quote",
    new Date("2026-09-18T01:00:00Z"),
  );

  assert.equal(dropAlreadyRecorded([same, { ...same }], []).length, 1);
});

test("an echo that lost its seconds is still recognised", () => {
  // Rows are stored with whatever precision the writer had, but they travel to
  // the client as a Sydney date plus HH:mm. The copy that comes back is the
  // same event with the seconds gone — this is the shape that slipped through
  // an exact comparison and inserted a second "Lead created".
  const stored = entry(
    "Lead created",
    "Lead manually created",
    new Date("2026-09-17T22:32:37.501Z"),
  );
  const echoed = entry(
    "Lead created",
    "Lead manually created",
    new Date("2026-09-17T22:32:00.000Z"),
  );

  assert.deepEqual(dropAlreadyRecorded([echoed], [stored]), []);
});

test("the next minute is a new entry", () => {
  const stored = entry(
    "Email sent",
    "Subject: Quote",
    new Date("2026-09-18T01:00:40Z"),
  );
  const next = entry(
    "Email sent",
    "Subject: Quote",
    new Date("2026-09-18T01:01:00Z"),
  );

  assert.deepEqual(dropAlreadyRecorded([next], [stored]), [next]);
});

test("the same action at a different time is a new entry", () => {
  const existing = [
    entry("Email sent", "Subject: Quote", new Date("2026-09-18T01:00:00Z")),
  ];
  const later = entry(
    "Email sent",
    "Subject: Quote",
    new Date("2026-09-18T02:00:00Z"),
  );

  assert.deepEqual(dropAlreadyRecorded([later], existing), [later]);
});

test("order is preserved", () => {
  const first = entry("A", "a", new Date("2026-09-18T01:00:00Z"));
  const second = entry("B", "b", new Date("2026-09-18T02:00:00Z"));

  assert.deepEqual(
    dropAlreadyRecorded([first, second], []).map((e) => e.action),
    ["A", "B"],
  );
});

// ── The timestamp half ──

test("a Sydney wall clock resolves to the instant it describes", () => {
  // 08:32 on 18 September in Sydney is AEST (UTC+10): 22:32 the day before.
  assert.equal(
    sydneyWallClockToInstant("2026-09-18", "08:32").toISOString(),
    "2026-09-17T22:32:00.000Z",
  );
});

test("daylight saving is honoured, not assumed", () => {
  // AEDT (UTC+11) from the first Sunday in October.
  assert.equal(
    sydneyWallClockToInstant("2026-12-01", "08:32").toISOString(),
    "2026-11-30T21:32:00.000Z",
  );
});

test("a round trip through the wall clock is stable", () => {
  // The bug: read an instant as a Sydney pair, write the pair back, and the
  // entry used to move ten hours every time it made the trip.
  const original = new Date("2026-09-17T22:32:00.000Z");
  const once = sydneyWallClockToInstant("2026-09-18", "08:32");
  assert.equal(once.getTime(), original.getTime());
});

test("a missing or malformed time falls back to midnight, not NaN", () => {
  assert.equal(
    sydneyWallClockToInstant("2026-09-18").toISOString(),
    "2026-09-17T14:00:00.000Z",
  );
  assert.equal(
    sydneyWallClockToInstant("2026-09-18", "").toISOString(),
    "2026-09-17T14:00:00.000Z",
  );
  assert.ok(
    !Number.isNaN(sydneyWallClockToInstant("2026-09-18", "nonsense").getTime()),
  );
});

test("a well-shaped but impossible time does not produce an Invalid Date", () => {
  // Lead.followupTime is free text. "24:99" matches HH:mm and used to reach
  // date-fns-tz, which returned an Invalid Date that Prisma rejected — failing
  // the whole lead save over a malformed reminder time.
  for (const bad of ["24:00", "24:99", "99:99", "23:60"]) {
    const resolved = sydneyWallClockToInstant("2026-09-18", bad);
    assert.ok(
      !Number.isNaN(resolved.getTime()),
      `${bad} produced an Invalid Date`,
    );
    assert.equal(resolved.toISOString(), "2026-09-17T14:00:00.000Z");
  }

  // The last valid minute of the day still passes through untouched.
  assert.equal(
    sydneyWallClockToInstant("2026-09-18", "23:59").toISOString(),
    "2026-09-18T13:59:00.000Z",
  );
});

// ── The callers ──

test("the email modal sends only the new entry", () => {
  const source = read("components/leads/modal-ui/email-flow-modal.tsx");

  assert.ok(
    !source.includes("...(lead.history ?? []), historyEntry"),
    "the email modal is handing back the lead's whole history again",
  );
  assert.ok(source.includes("history: [historyEntry]"));
  // And both halves of the pair come from the same Sydney reading.
  assert.ok(!source.includes("now.toISOString().slice(0, 10)"));
  assert.ok(source.includes("date: sydneyDateOnly(now)"));
  assert.ok(source.includes("time: sydneyTimeOnly(now)"));
});

test("the booking route sends only the new entry", () => {
  const source = read("app/api/graph/book-consultant/route.ts");

  assert.ok(
    !source.includes("upsertNoteHistory"),
    "the booking route is merging the lead's history again",
  );
  assert.ok(source.includes("history: [noteEntry]"));
});

// ── The audit trail ──

test("a stage change records where the lead came from", () => {
  const at = new Date("2026-09-18T22:50:00.000Z");
  const built = buildStageChangedHistoryEntry("DISCOVERY", "QUALIFIED", at);

  assert.equal(built.action, "Stage changed");
  assert.equal(built.detail, "Discovery → Qualified");
  assert.equal(built.type, "system");
  // Sydney, so the feed agrees with the clock the operator was looking at.
  assert.equal(built.date, "2026-09-19");
  assert.equal(built.time, "08:50");
});

test("updateLead writes the stage entry and drops duplicates", () => {
  // The rule moved to lib/domain/leads/commands.ts (issue #301) so the routes,
  // the MCP tool and the booking path all get it. lib/data/leads.ts is the
  // Next adapter over it now.
  const source = read("lib/domain/leads/commands.ts");

  assert.ok(source.includes("buildStageChangedHistoryEntry("));
  assert.ok(source.includes("dropAlreadyRecorded("));
  assert.ok(
    source.includes("actionDate: sydneyWallClockToInstant(h.date, h.time)"),
    "history timestamps are being read in the server's zone again",
  );
  assert.ok(
    !source.includes("new Date(`${h.date}T${h.time"),
    "the raw wall-clock parse is back",
  );
});

test("tasks write to the activity feed", () => {
  const source = read("lib/domain/leads/tasks.ts");

  assert.ok(source.includes("buildTaskAddedHistoryEntry("));
  assert.ok(source.includes("buildTaskCompletedHistoryEntry("));
  // The stage move a booking triggers is logged by the path that made it.
  assert.ok(source.includes("buildStageChangedHistoryEntry("));
});

// ── What the guard must NOT touch ──

test("the guard filters caller history only, never generated entries", () => {
  const source = read("lib/domain/leads/commands.ts");

  // dropAlreadyRecorded wraps input.history and nothing else. Applied to the
  // whole list it collapsed two mentions in the same minute into one, and lost
  // a stage move that was undone and redone inside a minute — leaving the feed
  // asserting the opposite of where the lead sat.
  assert.ok(
    source.includes(
      "...dropAlreadyRecorded(\n        (input.history ?? []).map(toRow),",
    ),
    "the echo guard is being applied to server-generated entries again",
  );
  for (const generated of [
    "...responseHistory.map(toRow)",
    "...meetingHistory.map(toRow)",
    "...annotationHistory.map(toRow)",
    "...stageHistory.map(toRow)",
  ]) {
    assert.ok(
      source.includes(generated),
      `${generated} is not written unfiltered`,
    );
  }
});

test("two mentions in the same minute both survive", () => {
  // Every mention carries the same action and the same hardcoded comment, so
  // the minute is all that distinguishes them - which is exactly why they must
  // not go through the guard. This pins the collapse the guard would cause.
  const at = new Date("2026-09-18T05:30:12.000Z");
  const mention = () =>
    entry("Lead note mention added", "Mentioned in lead note", at);

  assert.equal(
    dropAlreadyRecorded([mention(), mention()], []).length,
    1,
    "the guard is expected to collapse these - which is why mentions bypass it",
  );
});

test("a stage move undone and redone in one minute is two distinct entries", () => {
  const at = new Date("2026-09-18T05:30:00.000Z");
  const forward = buildStageChangedHistoryEntry("QUOTED", "NEGOTIATING", at);
  const back = buildStageChangedHistoryEntry("NEGOTIATING", "QUOTED", at);

  // Different details, so these two never collide...
  assert.notEqual(forward.detail, back.detail);
  // ...but the repeat of the first one does, which is the case that must not be
  // filtered. The lead ends on NEGOTIATING; the feed must not end on "-> Quoted".
  const repeat = buildStageChangedHistoryEntry("QUOTED", "NEGOTIATING", at);
  assert.equal(repeat.detail, forward.detail);
});

// ── The source must stay text ──

test("lead-history.ts contains no raw NUL byte", () => {
  // A literal NUL makes git treat the file as binary: "Binary files differ" in
  // the PR, skipped by grep and rg, and unreviewed - while compiling and
  // passing every test, because NUL is a legal string character. The separator
  // must be written as an escape.
  const source = readFileSync(
    join(process.cwd(), "lib/leads/lead-history.ts"),
    "utf8",
  );
  assert.ok(!source.includes("\u0000"), "a raw NUL byte is back in the source");
  assert.ok(
    source.includes("const SEPARATOR ="),
    "the separator constant is gone",
  );
});

test("every history-entry builder reads one clock", () => {
  // A UTC calendar date beside a browser-local time disagrees with itself by a
  // whole day, and updateLead now reads the pair as a Sydney wall clock.
  for (const file of [
    "components/leads/modal-ui/email-flow-modal.tsx",
    "components/leads/detail/lead-notes-tab.tsx",
  ]) {
    const source = read(file);
    assert.ok(
      !source.includes("now.toISOString().slice(0, 10)"),
      `${file} still builds a history date from the UTC calendar`,
    );
    assert.ok(
      !source.includes("now.toTimeString().slice(0, 5)"),
      `${file} still builds a history time from the browser clock`,
    );
    assert.ok(
      source.includes("sydneyDateOnly(now)"),
      `${file} lost sydneyDateOnly`,
    );
    assert.ok(
      source.includes("sydneyTimeOnly(now)"),
      `${file} lost sydneyTimeOnly`,
    );
  }
});
