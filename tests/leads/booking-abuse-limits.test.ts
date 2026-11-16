import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import {
  BOOKING_LIMITS,
  bookingLimitReached,
  calendarSafeName,
  checkBookingLimits,
  MAX_BOOKING_NAME_LENGTH,
} from "@/lib/domain/leads/booking-limits";
import {
  assertWithinBookingWindow,
  MAX_BOOKING_DAYS_AHEAD,
} from "@/lib/domain/leads/consultation-hours";
import { DomainValidationError } from "@/lib/domain/errors";

import { REPO_ROOT } from "../support/repo-root";

// Issue #322: the public booking route had no limit of any kind, and a loop of
// bookings fills the company calendar and blocks genuine clients.

test("a person is never near the limits, a script reaches them", () => {
  const quiet = { email: 0, lastHour: 0, lastDay: 0 };
  assert.equal(bookingLimitReached(quiet), null);
  assert.equal(
    bookingLimitReached({ ...quiet, email: BOOKING_LIMITS.perEmailPerDay - 1 }),
    null,
  );
  assert.match(
    bookingLimitReached({ ...quiet, email: BOOKING_LIMITS.perEmailPerDay })
      ?? "",
    /several bookings today/,
  );
  // Rotating addresses does not get round the cap across everyone.
  assert.match(
    bookingLimitReached({ ...quiet, lastHour: BOOKING_LIMITS.perHour }) ?? "",
    /a lot of bookings/,
  );
  assert.match(
    bookingLimitReached({ ...quiet, lastDay: BOOKING_LIMITS.perDay }) ?? "",
    /a lot of bookings/,
  );
});

function fakeDb(rows: {
  existing: boolean;
  email: number;
  lastHour: number;
  lastDay: number;
}) {
  return {
    outboxEvent: {
      findUnique: async () => (rows.existing ? { id: "x" } : null),
      count: async (args: {
        where: { createdAt: { gte: Date }; payload?: unknown };
      }) => {
        if (args.where.payload !== undefined) return rows.email;
        const ageMs = Date.now() - args.where.createdAt.gte.getTime();
        return ageMs < 2 * 60 * 60 * 1000 ? rows.lastHour : rows.lastDay;
      },
    },
  } as unknown as Parameters<typeof checkBookingLimits>[0];
}

test("a booking over the per-email limit is refused with a reason", async () => {
  const verdict = await checkBookingLimits(
    fakeDb({
      existing: false,
      email: BOOKING_LIMITS.perEmailPerDay,
      lastHour: 0,
      lastDay: 0,
    }),
    {
      key: "consultation:2026-12-01T03:00:00.000Z:a@example.com",
      email: "A@Example.com",
    },
  );
  assert.equal(verdict.allowed, false);
  assert.ok(!verdict.allowed && verdict.message.length > 0);
});

test("a resubmission of a booking already recorded is let through at the limit", async () => {
  // A double-click or a retry after a timeout answers with the first meeting
  // and makes nothing new, so it must not be told "too many".
  const verdict = await checkBookingLimits(
    fakeDb({ existing: true, email: 99, lastHour: 99, lastDay: 99 }),
    {
      key: "consultation:2026-12-01T03:00:00.000Z:a@example.com",
      email: "a@example.com",
    },
  );
  assert.deepEqual(verdict, { allowed: true });
});

test("a booking can be made up to sixty days ahead and not before tomorrow", () => {
  const today = "2026-11-16";
  assertWithinBookingWindow("2026-11-17T14:00:00", today);
  assertWithinBookingWindow("2027-01-15T14:00:00", today); // 60 days
  for (const [label, start] of [
    ["today", "2026-11-16T15:00:00"],
    ["yesterday", "2026-11-15T15:00:00"],
    ["a year of Fridays out", "2027-11-12T15:00:00"],
    ["61 days", "2027-01-16T14:00:00"],
  ] as const) {
    assert.throws(
      () => assertWithinBookingWindow(start, today),
      DomainValidationError,
      label,
    );
  }
  assert.equal(MAX_BOOKING_DAYS_AHEAD, 60);
});

test("a caller's name cannot put a second line or a page into the calendar subject", () => {
  assert.equal(calendarSafeName("Jane Citizen"), "Jane Citizen");
  assert.equal(
    calendarSafeName("Jane\r\nBCC: x@example.com\n\nPay now"),
    "Jane BCC: x@example.com Pay now",
  );
  assert.equal(calendarSafeName("  \t\n "), "Client");
  assert.equal(
    calendarSafeName("x".repeat(500)).length,
    MAX_BOOKING_NAME_LENGTH,
  );
  // The Unicode line and paragraph separators count as line breaks too.
  assert.equal(
    calendarSafeName(
      `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`,
    ),
    "a b c",
  );
});

test("the booking route applies the limits on the anonymous path before it touches the calendar", () => {
  // The route reaches server-only code, so read its source: the order is the
  // point. Limits first, the calendar read after, the caller's name cleaned.
  const source = readFileSync(
    join(REPO_ROOT, "app/api/graph/book-consultant/route.ts"),
    "utf8",
  );
  assert.match(source, /assertWithinBookingWindow\(String\(startDateTime\)/);
  assert.match(
    source,
    /leadClaim\.kind === "anonymous"[\s\S]*bookingAddressBrake\.allow\(requestAddress\(req\)\)/,
  );
  const limits = source.indexOf("checkBookingLimits(prisma");
  const calendar = source.indexOf("await findConflictingEvent(");
  assert.ok(
    limits > 0 && calendar > limits,
    "limits must run before the calendar is read",
  );
  assert.match(source, /status: 429/);
  assert.match(
    source,
    /const subjectName = calendarSafeName\(String\(name\)\)/,
  );
  assert.doesNotMatch(source, /Consultation with \$\{name\}/);
});
