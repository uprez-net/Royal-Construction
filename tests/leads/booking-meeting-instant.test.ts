import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fromZonedTime } from "date-fns-tz";

import {
  sydneyTimeOnly,
  sydneyTimeZoneAbbreviation,
} from "../../lib/dates/sydney";

// A consultation booked for Tuesday 22 September at 3:00 PM AEST reached the
// client correctly — the email and the .ics both said 3pm — while the lead's
// own task said "Wed, 23 Sept · 01:00".
//
// The route carries two readings of the same moment. `start` is the Sydney wall
// clock encoded as UTC, which is what the Graph payload needs, because
// formatToGraphDateTime reads it with local getters on a UTC server and the
// event is then labelled Australia/Sydney. `slotStart` is the real instant, and
// the route already derived it for the conflict check. Persistence was given
// `start`.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const ROUTE = "app/api/graph/book-consultant/route.ts";

const BOOKING_TIMEZONE = "Australia/Sydney";

test("the wall clock Graph is given resolves to the instant that was booked", () => {
  // What formatToGraphDateTime produces on a UTC server for a 3:00 PM slot.
  const graphStartStr = "2026-09-22T15:00:00";
  const slotStart = fromZonedTime(graphStartStr, BOOKING_TIMEZONE);

  assert.equal(slotStart.toISOString(), "2026-09-22T05:00:00.000Z");
  // And read back in Sydney it is the time the client was shown.
  assert.equal(sydneyTimeOnly(slotStart), "15:00");
});

test("the wall clock stored as an instant is the bug, ten hours out", () => {
  // The old behaviour, kept as the thing the fix must not reproduce.
  const wallClockAsInstant = new Date("2026-09-22T15:00:00.000Z");

  assert.equal(sydneyTimeOnly(wallClockAsInstant), "01:00");
  assert.notEqual(
    wallClockAsInstant.toISOString(),
    fromZonedTime("2026-09-22T15:00:00", BOOKING_TIMEZONE).toISOString(),
  );
});

test("a morning slot hides the fault, which is why it reads as an afternoon bug", () => {
  // 09:00 AEST is 23:00Z the previous day: same Sydney calendar day either way
  // once read back, so only afternoon bookings visibly land on the wrong date.
  const morning = fromZonedTime("2026-09-22T09:00:00", BOOKING_TIMEZONE);
  assert.equal(morning.toISOString(), "2026-09-21T23:00:00.000Z");
  assert.equal(sydneyTimeOnly(morning), "09:00");
});

// ── The timezone label shown to the client ──

test("the label follows daylight saving, both sides of both switches", () => {
  const cases: [string, "AEST" | "AEDT"][] = [
    // 2026 switches: AEDT begins Sun 4 Oct 2am, ends Sun 5 Apr 3am.
    ["2026-09-22T05:00:00Z", "AEST"], // 22 Sep, 3pm — before the October switch
    ["2026-10-02T05:00:00Z", "AEST"], // 3 Oct, 3pm — the day before
    ["2026-10-06T05:00:00Z", "AEDT"], // 6 Oct, 4pm — the booking that exposed it
    ["2026-12-25T02:00:00Z", "AEDT"], // midsummer
    ["2026-04-04T04:00:00Z", "AEDT"], // 4 Apr, 3pm — the day before it ends
    ["2026-04-06T05:00:00Z", "AEST"], // 6 Apr, 3pm — after
    ["2026-07-01T05:00:00Z", "AEST"], // midwinter
  ];

  for (const [iso, expected] of cases) {
    assert.equal(
      sydneyTimeZoneAbbreviation(new Date(iso)),
      expected,
      `${iso} should read ${expected}`,
    );
  }
});

test("the label and the stored instant describe the same moment", () => {
  // What the client is shown and what the calendar carries cannot disagree.
  const slotStart = fromZonedTime("2026-10-06T16:00:00", BOOKING_TIMEZONE);

  assert.equal(slotStart.toISOString(), "2026-10-06T05:00:00.000Z");
  assert.equal(sydneyTimeOnly(slotStart), "16:00");
  assert.equal(sydneyTimeZoneAbbreviation(slotStart), "AEDT");
});

test("neither the email nor the booking page hardcodes the label", () => {
  const route = read(ROUTE);
  assert.ok(
    route.includes("(${sydneyTimeZoneAbbreviation(slotStart)})"),
    "the confirmation email is hardcoding AEST again",
  );
  assert.ok(!route.includes("(AEST)`"));

  const page = read("app/book-consultation/page.tsx");
  // Both the hours banner and the chosen-time summary.
  assert.equal(page.split("{selectedZoneLabel}").length - 1, 2);
  assert.ok(
    !/\(AEST\)\s*$/m.test(page.replace(/^\s*\/\/.*$/gm, "")),
    "a hardcoded AEST label is still rendered on the booking page",
  );
});

test("the route persists the instant, not the wall clock", () => {
  const source = read(ROUTE);

  assert.ok(
    source.includes("meetingAt: slotStart"),
    "the booking is being stored from the Graph wall clock again",
  );
  assert.ok(
    !/meetingAt: start\b/.test(source),
    "`start` is reaching the lead record again",
  );
  // slotStart is still the value the conflict check uses, so the two cannot
  // drift apart.
  assert.ok(source.includes("const slotStart = fromZonedTime("));
  // And the Graph payload still gets the wall clock it needs.
  assert.ok(
    source.includes('start: { dateTime: graphStartStr, timeZone: "Australia/Sydney" }'),
  );
});
