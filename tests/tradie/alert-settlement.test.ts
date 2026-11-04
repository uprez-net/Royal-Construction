import assert from "node:assert/strict";

import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import { DomainNotFoundError } from "@/lib/domain/errors";
import { updateMilestone } from "@/lib/domain/projects/milestones";
import {
  bookingLastDay,
  isTradieAlertLive,
  type AlertBooking,
} from "@/lib/domain/tradies/alert-rules";
import { dismissTradieScheduleAlerts } from "@/lib/domain/tradies/alerts";
import { settledBookingStatus } from "@/lib/domain/tradies/lifecycle";
import {
  completeElapsedBookings,
  settleMilestoneBookings,
} from "@/lib/domain/tradies/settlement";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// Tradie alerts are derived from bookings, and used to clear only when someone
// moved a booking by hand. These cover the cascades that now close bookings,
// and the one rule for when an alert is over.

const {
  AWAITING_ADMIN_APPROVAL,
  CANCELLED,
  COMPLETED,
  CONFIRMED,
  DECLINED,
  NO_RESPONSE,
  PENDING,
  PENDING_FINAL_CONFIRMATION,
} = TradieScheduleStatus;

const TODAY = "2026-10-08";

function booking(
  overrides: Partial<AlertBooking> & { id?: string } = {},
): AlertBooking {
  return {
    durationDays: 1,
    id: "s_1",
    milestone: { status: MilestoneStatus.ACTIVE },
    milestoneId: "m_1",
    scheduledDate: new Date("2026-10-12T00:00:00.000Z"),
    status: PENDING,
    tradie: { trade: "Electrical" },
    ...overrides,
  };
}

/* ------------------------------------------------- what settling one does */

test("a finished milestone completes approved bookings and cancels the rest", () => {
  assert.equal(settledBookingStatus(CONFIRMED, "DONE"), COMPLETED);
  assert.equal(
    settledBookingStatus(PENDING_FINAL_CONFIRMATION, "DONE"),
    COMPLETED,
  );
  for (const open of [PENDING, NO_RESPONSE, AWAITING_ADMIN_APPROVAL]) {
    assert.equal(settledBookingStatus(open, "DONE"), CANCELLED);
  }
});

test("a waived milestone cancels every open booking, approved or not", () => {
  assert.equal(settledBookingStatus(CONFIRMED, "NOT_REQUIRED"), CANCELLED);
  assert.equal(settledBookingStatus(PENDING, "NOT_REQUIRED"), CANCELLED);
});

test("bookings already over are history and are left alone", () => {
  for (const over of [DECLINED, COMPLETED, CANCELLED]) {
    assert.equal(settledBookingStatus(over, "DONE"), null);
    assert.equal(settledBookingStatus(over, "NOT_REQUIRED"), null);
  }
});

/* ------------------------------------------------------ when an alert is over */

test("a booking's last day counts its first", () => {
  assert.equal(
    bookingLastDay({
      durationDays: 3,
      scheduledDate: new Date("2026-10-06T00:00:00.000Z"),
    }),
    "2026-10-08",
  );
});

test("a dismissed alert stays hidden until the booking moves on", () => {
  assert.equal(
    isTradieAlertLive(
      booking({ alertDismissedStatus: NO_RESPONSE, status: NO_RESPONSE }),
      [],
      TODAY,
    ),
    false,
  );
  assert.equal(
    isTradieAlertLive(
      booking({ alertDismissedStatus: NO_RESPONSE, status: DECLINED }),
      [],
      TODAY,
    ),
    true,
  );
});

test("no alert outlives its milestone", () => {
  for (const status of [MilestoneStatus.DONE, MilestoneStatus.NOT_REQUIRED]) {
    assert.equal(
      isTradieAlertLive(
        booking({ milestone: { status }, status: NO_RESPONSE }),
        [],
        TODAY,
      ),
      false,
    );
  }
});

test("chasing an answer stops once the booked date has gone", () => {
  const due = booking({ status: NO_RESPONSE });
  assert.equal(isTradieAlertLive(due, [], TODAY), true);
  assert.equal(
    isTradieAlertLive(
      { ...due, scheduledDate: new Date("2026-10-07T00:00:00.000Z") },
      [],
      TODAY,
    ),
    false,
  );
});

test("a confirmed job alerts until its last day, not just its first", () => {
  const underway = booking({
    durationDays: 3,
    scheduledDate: new Date("2026-10-07T00:00:00.000Z"),
    status: CONFIRMED,
  });
  assert.equal(isTradieAlertLive(underway, [], TODAY), true);
  assert.equal(
    isTradieAlertLive({ ...underway, durationDays: 1 }, [], TODAY),
    false,
  );
});

test("a declined tradie stops asking for a replacement once one is booked", () => {
  const declined = booking({ id: "s_declined", status: DECLINED });
  const replacement = booking({ id: "s_new", status: PENDING });

  assert.equal(isTradieAlertLive(declined, [declined], TODAY), true);
  assert.equal(
    isTradieAlertLive(declined, [declined, replacement], TODAY),
    false,
  );
});

test("only the same trade on the same milestone, still active, replaces it", () => {
  const declined = booking({ id: "s_declined", status: CANCELLED });
  const others = [
    booking({ id: "s_plumber", tradie: { trade: "Plumbing" } }),
    booking({ id: "s_elsewhere", milestoneId: "m_2" }),
    booking({ id: "s_also_declined", status: DECLINED }),
  ];

  assert.equal(isTradieAlertLive(declined, [declined, ...others], TODAY), true);
});

test("an alert is never kept for a completed booking", () => {
  assert.equal(
    isTradieAlertLive(booking({ status: COMPLETED }), [], TODAY),
    false,
  );
});

/* ------------------------------------------------- the cascades, recorded */

type Write = { operation: string; args: unknown };

const statusWrites = (writes: readonly Write[]) =>
  writes
    .filter((write) => write.operation === "tradieSchedule.updateMany")
    .map((write) => {
      const args = write.args as {
        data: { status: TradieScheduleStatus };
        where: { id: string };
      };
      return [args.data.status, args.where.id];
    });

test("settling a milestone writes each booking's settled status", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findMany": [
      { id: "s_confirmed", status: CONFIRMED },
      { id: "s_unanswered", status: NO_RESPONSE },
      { id: "s_approved", status: PENDING_FINAL_CONFIRMATION },
    ],
  });

  const result = await settleMilestoneBookings(
    { milestoneId: "m_1", settlement: "DONE" },
    recorder.db,
  );

  assert.deepEqual(result, {
    cancelled: ["s_unanswered"],
    completed: ["s_confirmed", "s_approved"],
  });
  assert.deepEqual(statusWrites(recorder.writes()), [
    [COMPLETED, "s_confirmed"],
    [CANCELLED, "s_unanswered"],
    [COMPLETED, "s_approved"],
  ]);

  // The approvals waiting on them are closed in the same breath.
  const approvals = recorder
    .writes()
    .filter((write) => write.operation === "tradieApproval.updateMany");
  assert.equal(approvals.length, 2);
});

test("a milestone with no open bookings writes nothing", async () => {
  const recorder = recordingDb({ "tradieSchedule.findMany": [] });

  await settleMilestoneBookings(
    { milestoneId: "m_1", settlement: "NOT_REQUIRED" },
    recorder.db,
  );

  assert.deepEqual(recorder.writes(), []);
});

test("completing a milestone settles its bookings in the same update", async () => {
  const recorder = recordingDb({
    "invoice.findUnique": null,
    "milestone.aggregate": { _sum: { spend: "500" } },
    "milestone.count": 1,
    "milestone.findMany": [],
    "milestone.findUnique": { projectId: "p_1" },
    "milestone.findUniqueOrThrow": {
      id: "m_1",
      name: "Rough-in",
      parentId: null,
      projectId: "p_1",
      status: MilestoneStatus.ACTIVE,
    },
    "milestone.update": {
      budget: { toString: () => "500" },
      id: "m_1",
      name: "Rough-in",
      parentId: null,
      projectId: "p_1",
      spend: { toString: () => "500" },
      status: MilestoneStatus.DONE,
    },
    "project.findUnique": {
      id: "p_1",
      location: "1 Site St",
      name: "House",
      siteManagerId: null,
    },
    "project.update": { siteManagerId: null, spent: "500" },
    "tradieSchedule.findMany": [{ id: "s_1", status: CONFIRMED }],
  });

  const outcome = await updateMilestone(
    adminPrincipal(),
    {
      actualDate: "2026-10-08",
      milestoneId: "m_1",
      spend: 500,
      startDate: "2026-10-01",
      status: MilestoneStatus.DONE,
    },
    recorder.db,
  );

  assert.deepEqual(outcome.settledBookings, {
    cancelled: [],
    completed: ["s_1"],
  });
});

test("the daily run completes confirmed bookings whose last day has passed", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findMany": [
      // Last day 6 Oct: over.
      {
        durationDays: 2,
        id: "s_done",
        scheduledDate: new Date("2026-10-05T00:00:00.000Z"),
      },
      // Last day 9 Oct: still on site.
      {
        durationDays: 3,
        id: "s_underway",
        scheduledDate: new Date("2026-10-07T00:00:00.000Z"),
      },
    ],
    "tradieSchedule.updateMany": { count: 1 },
  });

  const result = await completeElapsedBookings(
    new Date("2026-10-08T10:00:00+11:00"),
    recorder.db,
  );

  assert.equal(result.completed, 1);
  assert.deepEqual(statusWrites(recorder.writes()), [[COMPLETED, "s_done"]]);
});

test("a booking settled elsewhere since the read is not reported or logged", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findMany": [
      { id: "s_moved", projectId: "p_1", status: CONFIRMED, tradieId: "t_1" },
      { id: "s_open", projectId: "p_1", status: CONFIRMED, tradieId: "t_2" },
    ],
    "tradieSchedule.updateMany": (args: unknown) => ({
      count: (args as { where: { id: string } }).where.id === "s_moved" ? 0 : 1,
    }),
  });

  const result = await settleMilestoneBookings(
    { milestoneId: "m_1", settlement: "DONE" },
    recorder.db,
  );

  assert.deepEqual(result, { cancelled: [], completed: ["s_open"] });
  const logged = recorder
    .writes()
    .filter((write) => write.operation === "tradieActivityLog.create")
    .map(
      (write) =>
        (write.args as { data: { scheduleId: string } }).data.scheduleId,
    );
  assert.deepEqual(logged, ["s_open"]);
});

/* ---------------------------------------------------------------- dismissal */

test("a dismissal is remembered against the status the booking has now", async () => {
  const recorder = recordingDb({
    "project.findUnique": {
      id: "p_1",
      location: "1 Site St",
      name: "House",
      siteManagerId: null,
    },
    "tradieSchedule.findMany": [{ id: "s_1", status: NO_RESPONSE }],
    "tradieSchedule.updateMany": { count: 1 },
  });

  const result = await dismissTradieScheduleAlerts(
    adminPrincipal(),
    { projectId: "p_1", scheduleIds: ["s_1"] },
    recorder.db,
  );

  assert.deepEqual(result.dismissed, ["s_1"]);
  const [write] = recorder.writes();
  const args = write.args as {
    data: { alertDismissedStatus: TradieScheduleStatus };
    where: unknown;
  };
  assert.equal(args.data.alertDismissedStatus, NO_RESPONSE);
  // Conditional on that status, so a booking that just moved is not silenced.
  assert.deepEqual(args.where, { id: "s_1", status: NO_RESPONSE });
});

test("a booking from another project cannot be dismissed through this one", async () => {
  const recorder = recordingDb({
    "project.findUnique": {
      id: "p_1",
      location: "1 Site St",
      name: "House",
      siteManagerId: null,
    },
    "tradieSchedule.findMany": [],
  });

  await assert.rejects(
    () =>
      dismissTradieScheduleAlerts(
        adminPrincipal(),
        { projectId: "p_1", scheduleIds: ["s_elsewhere"] },
        recorder.db,
      ),
    DomainNotFoundError,
  );
  assert.deepEqual(recorder.writes(), []);
});
