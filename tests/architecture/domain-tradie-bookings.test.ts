import assert from "node:assert/strict";

import { TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import {
  bookingsOn,
  describeBooking,
  existingBooking,
  type TradieBooking,
} from "@/components/projects/detail/modal/tradie-bookings";
import {
  DomainAuthorizationError,
  DomainTransitionError,
} from "@/lib/domain/errors";
import {
  createTradieSchedules,
  listTradieBookings,
  rescheduleTradieSchedule,
} from "@/lib/domain/tradies/schedules";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// The schedule modal marks the days a tradie is already booked, in yellow, and
// lets the office book them anyway: one tradie on two sites, or two
// milestones, on the same day is their call. What is refused is the same
// booking twice — one tradie, one project, one milestone — and the refusal says
// when the existing one is, so the office can reschedule it instead.

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const ROWS = [
  {
    durationDays: 3,
    id: "s_running",
    milestone: { name: "Framing" },
    milestoneId: "m_framing",
    project: {
      id: "p_mine",
      name: "Smith residence",
      siteManagerId: "user_site_manager",
    },
    scheduledDate: day("2026-10-05"),
    status: TradieScheduleStatus.CONFIRMED,
  },
  {
    durationDays: 2,
    id: "s_finished",
    milestone: null,
    milestoneId: null,
    project: {
      id: "p_other",
      name: "Jones build",
      siteManagerId: "user_other",
    },
    scheduledDate: day("2026-10-01"),
    status: TradieScheduleStatus.PENDING,
  },
  {
    durationDays: 1,
    id: "s_later",
    milestone: { name: "Roofing" },
    milestoneId: "m_roofing",
    project: {
      id: "p_other",
      name: "Jones build",
      siteManagerId: "user_other",
    },
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
    bookings.map((booking) => [
      booking.scheduleId,
      booking.firstDay,
      booking.lastDay,
    ]),
    [
      ["s_running", "2026-10-05", "2026-10-07"],
      ["s_later", "2026-10-20", "2026-10-20"],
    ],
  );
  const where = (recorder.calls[0]?.args as { where: { status: unknown } })
    .where;
  assert.deepEqual(where.status, {
    notIn: [TradieScheduleStatus.DECLINED, TradieScheduleStatus.COMPLETED],
  });
});

test("a booking on a project the caller cannot manage is still marked, but unnamed", async () => {
  const bookings = await listTradieBookings(
    siteManagerPrincipal(),
    { from: day("2026-10-06"), tradieId: "t_1" },
    recordingDb({ "tradieSchedule.findMany": ROWS }).db,
  );
  assert.equal(bookings[0]?.projectName, "Smith residence");
  assert.equal(bookings[0]?.milestoneId, "m_framing");
  assert.equal(bookings[1]?.projectName, null);
  assert.equal(bookings[1]?.milestoneId, null);
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

const PROJECT = {
  id: "p_mine",
  location: "here",
  name: "Smith residence",
  siteManagerId: null,
};

test("a tradie already booked on those days is booked again for other work", async () => {
  const recorder = recordingDb({
    "milestone.findFirst": { id: "m_roofing" },
    "project.findUnique": PROJECT,
    "tradie.findUnique": { id: "t_1" },
    "tradieSchedule.findFirst": null,
    "tradieSchedule.create": (args: unknown) => ({
      ...(args as { data: Record<string, unknown> }).data,
      id: "s_new",
    }),
  });

  const [created] = await createTradieSchedules(
    adminPrincipal(),
    [
      {
        durationDays: 1,
        milestoneId: "m_roofing",
        projectId: "p_mine",
        requiresQuote: false,
        scheduledDate: day("2026-10-06"),
        tradieId: "t_1",
      },
    ],
    recorder.transactionalDb,
  );
  assert.equal(created?.id, "s_new");

  // The only schedule read is the duplicate lookup, and it is keyed on the
  // work, not the dates.
  const lookup = recorder.calls.find(
    (call) => call.operation === "tradieSchedule.findFirst",
  )?.args as { where: Record<string, unknown> };
  assert.deepEqual(lookup.where, {
    id: undefined,
    milestoneId: "m_roofing",
    projectId: "p_mine",
    status: {
      notIn: [TradieScheduleStatus.DECLINED, TradieScheduleStatus.COMPLETED],
    },
    tradieId: "t_1",
  });
  assert.ok(
    !recorder.operations().includes("tradieSchedule.findMany"),
    "no date-overlap read is left",
  );
});

test("the same booking twice is refused, names the dates and, in a bulk booking, the row", async () => {
  const recorder = recordingDb({
    "milestone.findFirst": { id: "m_framing" },
    "project.findUnique": PROJECT,
    "tradie.findUnique": { id: "t_1" },
    "tradieSchedule.findFirst": {
      durationDays: 3,
      scheduledDate: day("2026-10-05"),
    },
  });

  await assert.rejects(
    createTradieSchedules(
      adminPrincipal(),
      ["2026-10-21", "2026-10-28"].map((iso) => ({
        durationDays: 1,
        milestoneId: "m_framing",
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
        === "Booking 1: That tradie is already booked for this milestone from 5 Oct 2026 to 7 Oct 2026. Reschedule that booking instead of adding another.",
  );
  assert.deepEqual(recorder.writes(), []);
});

const EXISTING_SCHEDULE = {
  durationDays: 1,
  id: "s_running",
  milestone: { id: "m_framing", name: "Framing" },
  milestoneId: "m_framing",
  project: { id: "p_mine", name: "Smith residence", siteManagerId: null },
  projectId: "p_mine",
  quotedPrice: null,
  scheduledDate: day("2026-10-05"),
  status: TradieScheduleStatus.PENDING,
  tradie: { id: "t_1", name: "Sam" },
  tradieId: "t_1",
};

test("moving a booking onto a milestone the tradie already holds is refused", async () => {
  const recorder = recordingDb({
    "milestone.findFirst": { id: "m_roofing" },
    "project.findUnique": PROJECT,
    "tradieSchedule.findFirst": {
      durationDays: 1,
      scheduledDate: day("2026-10-20"),
    },
    "tradieSchedule.findUnique": EXISTING_SCHEDULE,
  });

  await assert.rejects(
    rescheduleTradieSchedule(
      adminPrincipal(),
      {
        milestoneId: "m_roofing",
        scheduledDate: day("2026-10-20"),
        scheduleId: "s_running",
      },
      recorder.db,
    ),
    DomainTransitionError,
  );
  const lookup = recorder.calls.find(
    (call) => call.operation === "tradieSchedule.findFirst",
  )?.args as { where: { id: unknown } };
  assert.deepEqual(lookup.where.id, { not: "s_running" });
  assert.deepEqual(recorder.writes(), []);
});

test("moving a booking's dates needs no duplicate check", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "tradieSchedule.findUnique": EXISTING_SCHEDULE,
    "tradieSchedule.updateMany": { count: 1 },
  });

  await rescheduleTradieSchedule(
    adminPrincipal(),
    { scheduledDate: day("2026-10-20"), scheduleId: "s_running" },
    recorder.db,
  );
  assert.ok(!recorder.operations().includes("tradieSchedule.findFirst"));
});

const BOOKINGS: TradieBooking[] = [
  {
    firstDay: "2026-10-05",
    lastDay: "2026-10-07",
    milestoneId: "m_framing",
    milestoneName: "Framing",
    projectId: "p_mine",
    projectName: "Smith residence",
    scheduleId: "s_running",
    status: TradieScheduleStatus.CONFIRMED,
  },
];

test("the modal marks booked days half-open and spots only the same booking", () => {
  assert.equal(bookingsOn(BOOKINGS, "2026-10-04").length, 0);
  assert.equal(bookingsOn(BOOKINGS, "2026-10-07").length, 1);
  assert.equal(bookingsOn(BOOKINGS, "2026-10-08").length, 0);
  // Same project and milestone is the server's refusal; anything else is not.
  assert.equal(
    existingBooking(BOOKINGS, "p_mine", "m_framing")?.scheduleId,
    "s_running",
  );
  assert.equal(existingBooking(BOOKINGS, "p_mine", "m_roofing"), undefined);
  assert.equal(existingBooking(BOOKINGS, "p_other", "m_framing"), undefined);
  assert.equal(existingBooking(BOOKINGS, "p_mine", undefined), undefined);
  assert.equal(
    describeBooking(BOOKINGS[0]),
    "Smith residence · Framing, 5 Oct 2026 – 7 Oct 2026",
  );
});
