import assert from "node:assert/strict";

import { TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import {
  bookingsOn,
  describeBooking,
  overlappingBookings,
  type TradieBooking,
} from "@/components/projects/detail/modal/tradie-bookings";
import {
  DomainAuthorizationError,
  DomainTransitionError,
} from "@/lib/domain/errors";
import {
  createTradieSchedules,
  listTradieBookings,
} from "@/lib/domain/tradies/schedules";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// The schedule modal greys out the days a tradie is already booked, and a
// refused overlap says when the clash is. Production showed the office only
// "Failed to bulk create tradie schedules." for a double booking.

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const ROWS = [
  {
    durationDays: 3,
    id: "s_running",
    milestone: { name: "Framing" },
    project: { id: "p_mine", name: "Smith residence", siteManagerId: "user_site_manager" },
    scheduledDate: day("2026-10-05"),
    status: TradieScheduleStatus.CONFIRMED,
  },
  {
    durationDays: 2,
    id: "s_finished",
    milestone: null,
    project: { id: "p_other", name: "Jones build", siteManagerId: "user_other" },
    scheduledDate: day("2026-10-01"),
    status: TradieScheduleStatus.PENDING,
  },
  {
    durationDays: 1,
    id: "s_later",
    milestone: { name: "Roofing" },
    project: { id: "p_other", name: "Jones build", siteManagerId: "user_other" },
    scheduledDate: day("2026-10-20"),
    status: TradieScheduleStatus.PENDING,
  },
];

test("a tradie's bookings run from today, inclusive last day, and skip finished ones", async () => {
  const recorder = recordingDb({ "tradieSchedule.findMany": ROWS });
  const bookings = await listTradieBookings(
    adminPrincipal(),
    { from: day("2026-10-06"), tradieId: "t_1" },
    recorder.db,
  );

  assert.deepEqual(
    bookings.map((booking) => [booking.scheduleId, booking.firstDay, booking.lastDay]),
    [
      ["s_running", "2026-10-05", "2026-10-07"],
      ["s_later", "2026-10-20", "2026-10-20"],
    ],
  );
  const where = (recorder.calls[0]?.args as { where: { status: unknown } }).where;
  assert.deepEqual(where.status, {
    notIn: [TradieScheduleStatus.DECLINED, TradieScheduleStatus.COMPLETED],
  });
});

test("a booking on a project the caller cannot manage still blocks, but unnamed", async () => {
  const bookings = await listTradieBookings(
    siteManagerPrincipal(),
    { from: day("2026-10-06"), tradieId: "t_1" },
    recordingDb({ "tradieSchedule.findMany": ROWS }).db,
  );
  assert.equal(bookings[0]?.projectName, "Smith residence");
  assert.equal(bookings[1]?.projectName, null);
  assert.equal(bookings[1]?.milestoneName, null);
});

test("a customer may not read a tradie's bookings", async () => {
  await assert.rejects(
    listTradieBookings(
      customerPrincipal(),
      { from: day("2026-10-06"), tradieId: "t_1" },
      recordingDb().db,
    ),
    DomainAuthorizationError,
  );
});

test("a refused overlap names the clashing dates and, in a bulk booking, the row", async () => {
  const recorder = recordingDb({
    "project.findUnique": {
      id: "p_mine",
      location: "here",
      name: "Smith residence",
      siteManagerId: null,
    },
    "tradie.findUnique": { id: "t_1" },
    "tradieSchedule.findMany": [
      { durationDays: 3, id: "s_running", scheduledDate: day("2026-10-05") },
    ],
  });

  await assert.rejects(
    createTradieSchedules(
      adminPrincipal(),
      ["2026-10-06", "2026-10-21"].map((iso) => ({
        durationDays: 1,
        projectId: "p_mine",
        requiresQuote: false,
        scheduledDate: day(iso),
        tradieId: "t_1",
      })),
      recorder.transactionalDb,
    ),
    (error: unknown) =>
      error instanceof DomainTransitionError
      && error.message
        === "Booking 1: That tradie is already booked from 5 Oct 2026 to 7 Oct 2026, which overlaps the requested dates.",
  );
});

const BOOKINGS: TradieBooking[] = [
  {
    firstDay: "2026-10-05",
    lastDay: "2026-10-07",
    milestoneName: "Framing",
    projectId: "p_mine",
    projectName: "Smith residence",
    scheduleId: "s_running",
    status: TradieScheduleStatus.CONFIRMED,
  },
];

test("the modal's day arithmetic matches the half-open rule", () => {
  assert.equal(bookingsOn(BOOKINGS, "2026-10-04").length, 0);
  assert.equal(bookingsOn(BOOKINGS, "2026-10-07").length, 1);
  assert.equal(bookingsOn(BOOKINGS, "2026-10-08").length, 0);
  // Starting before and running into the booking overlaps it.
  assert.equal(overlappingBookings(BOOKINGS, "2026-10-03", 3).length, 1);
  assert.equal(overlappingBookings(BOOKINGS, "2026-10-03", 2).length, 0);
  assert.equal(overlappingBookings(BOOKINGS, "2026-10-08", 5).length, 0);
  assert.equal(
    describeBooking(BOOKINGS[0]),
    "Smith residence · Framing, 5 Oct 2026 – 7 Oct 2026",
  );
});
