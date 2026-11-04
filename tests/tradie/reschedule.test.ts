import assert from "node:assert/strict";

import { TradieApprovalStatus, TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import {
  DomainStaleVersionError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { tradieReplyStatus } from "@/lib/domain/tradies/replies";
import { rescheduleOutcome } from "@/lib/domain/tradies/reschedule-rules";
import { rescheduleTradieSchedule } from "@/lib/domain/tradies/schedules";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// Moving a booking to another day — the site is not ready — puts it back to
// the tradie, and how far back depends on whether the office had approved it.
// An approved booking stays approved and only needs the tradie to confirm the
// new date; anything else needs their availability again.

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const PROJECT = {
  id: "p_1",
  location: "Sydney",
  name: "Smith residence",
  siteManagerId: null,
};

function booking(status: TradieScheduleStatus) {
  return {
    durationDays: 2,
    id: "s_1",
    milestone: { id: "m_1", name: "Framing" },
    milestoneId: "m_1",
    project: { id: "p_1", name: "Smith residence", siteManagerId: null },
    projectId: "p_1",
    quotedPrice: null,
    scheduledDate: day("2026-10-20"),
    status,
    tradie: { archivedAt: null, id: "t_1", name: "Sam" },
    tradieId: "t_1",
  };
}

function scheduleWrite(recorder: ReturnType<typeof recordingDb>) {
  return recorder
    .writes()
    .find((call) => call.operation === "tradieSchedule.updateMany")?.args as
    | { data: Record<string, unknown>; where: Record<string, unknown> }
    | undefined;
}

test("each status lands where the office's rule says", () => {
  const expected: Record<
    TradieScheduleStatus,
    readonly [TradieScheduleStatus, string, boolean] | null
  > = {
    [TradieScheduleStatus.CONFIRMED]: [
      TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
      "reconfirm-attendance",
      false,
    ],
    [TradieScheduleStatus.PENDING_FINAL_CONFIRMATION]: [
      TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
      "reconfirm-attendance",
      false,
    ],
    [TradieScheduleStatus.AWAITING_ADMIN_APPROVAL]: [
      TradieScheduleStatus.PENDING_RESPONSE,
      "confirm-availability",
      true,
    ],
    [TradieScheduleStatus.PENDING]: [
      TradieScheduleStatus.PENDING,
      "confirm-availability",
      false,
    ],
    [TradieScheduleStatus.PENDING_RESPONSE]: [
      TradieScheduleStatus.PENDING_RESPONSE,
      "confirm-availability",
      false,
    ],
    [TradieScheduleStatus.NO_RESPONSE]: [
      TradieScheduleStatus.NO_RESPONSE,
      "confirm-availability",
      false,
    ],
    [TradieScheduleStatus.AWAITING_QUOTE]: [
      TradieScheduleStatus.AWAITING_QUOTE,
      "confirm-availability",
      false,
    ],
    [TradieScheduleStatus.QUOTE_RECEIVED]: [
      TradieScheduleStatus.QUOTE_RECEIVED,
      "confirm-availability",
      false,
    ],
    [TradieScheduleStatus.DECLINED]: null,
    [TradieScheduleStatus.COMPLETED]: null,
    [TradieScheduleStatus.CANCELLED]: null,
  };

  for (const status of Object.values(TradieScheduleStatus)) {
    const outcome = rescheduleOutcome(status);
    assert.deepEqual(
      outcome && [outcome.status, outcome.notice, outcome.withdrawsApproval],
      expected[status],
      status,
    );
  }
});

test("the tradie's yes settles an approved reschedule with no second approval", () => {
  // The other half of the rule is the reply handler's: a yes on a booking
  // waiting for final confirmation confirms it, a yes on anything else goes
  // to an admin.
  const approved = rescheduleOutcome(TradieScheduleStatus.CONFIRMED);
  assert.ok(approved);
  assert.equal(
    tradieReplyStatus(approved.status, true),
    TradieScheduleStatus.CONFIRMED,
  );
  const unapproved = rescheduleOutcome(
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
  );
  assert.ok(unapproved);
  assert.equal(
    tradieReplyStatus(unapproved.status, true),
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
  );
});

test("moving an approved booking keeps it approved and waits on the tradie", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "tradieSchedule.findUnique": booking(TradieScheduleStatus.CONFIRMED),
    "tradieSchedule.updateMany": { count: 1 },
  });

  const moved = await rescheduleTradieSchedule(
    adminPrincipal(),
    {
      expectedStatus: TradieScheduleStatus.CONFIRMED,
      scheduleId: "s_1",
      scheduledDate: day("2026-10-21"),
    },
    recorder.db,
  );

  assert.equal(moved.status, TradieScheduleStatus.PENDING_FINAL_CONFIRMATION);
  assert.equal(moved.notice, "reconfirm-attendance");
  assert.equal(moved.withdrewApproval, false);
  assert.deepEqual(moved.previousScheduledDate, day("2026-10-20"));
  assert.deepEqual(scheduleWrite(recorder)?.data, {
    alertDismissedAt: null,
    alertDismissedStatus: null,
    durationDays: 2,
    // Cleared so the week-out reminder runs again for the new date.
    reminderSentAt: null,
    scheduledDate: day("2026-10-21"),
    status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
  });
  assert.ok(
    !recorder.operations().includes("tradieApproval.updateMany"),
    "an approved booking has no pending approval to withdraw",
  );
});

test("moving a booking an admin has not approved yet withdraws the approval for the old date", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "tradieSchedule.findUnique": booking(
      TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    ),
    "tradieSchedule.updateMany": { count: 1 },
    "tradieApproval.updateMany": { count: 1 },
  });

  const moved = await rescheduleTradieSchedule(
    adminPrincipal(),
    { scheduleId: "s_1", scheduledDate: day("2026-10-21") },
    recorder.db,
  );

  assert.equal(moved.status, TradieScheduleStatus.PENDING_RESPONSE);
  assert.equal(moved.notice, "confirm-availability");
  assert.equal(moved.withdrewApproval, true);
  const withdrawal = recorder
    .writes()
    .find((call) => call.operation === "tradieApproval.updateMany")?.args as {
    data: { status: TradieApprovalStatus; rejectionReason: string };
    where: { status: TradieApprovalStatus };
  };
  assert.equal(withdrawal.where.status, TradieApprovalStatus.PENDING);
  assert.equal(withdrawal.data.status, TradieApprovalStatus.REJECTED);
  assert.match(withdrawal.data.rejectionReason, /21 Oct 2026/);
});

test("a booking still waiting on the tradie keeps its status", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "tradieSchedule.findUnique": booking(TradieScheduleStatus.PENDING),
    "tradieSchedule.updateMany": { count: 1 },
  });

  const moved = await rescheduleTradieSchedule(
    adminPrincipal(),
    { durationDays: 3, scheduleId: "s_1", scheduledDate: day("2026-10-20") },
    recorder.db,
  );

  // A longer stay is a change the tradie has to agree to, same as a new day.
  assert.equal(moved.notice, "confirm-availability");
  assert.equal(
    scheduleWrite(recorder)?.data.status,
    TradieScheduleStatus.PENDING,
  );
});

test("moving only the milestone leaves the tradie's answer standing", async () => {
  const recorder = recordingDb({
    "milestone.findFirst": { id: "m_2" },
    "project.findUnique": PROJECT,
    "tradieSchedule.findFirst": null,
    "tradieSchedule.findUnique": booking(TradieScheduleStatus.CONFIRMED),
    "tradieSchedule.updateMany": { count: 1 },
  });

  const moved = await rescheduleTradieSchedule(
    adminPrincipal(),
    {
      milestoneId: "m_2",
      scheduleId: "s_1",
      scheduledDate: day("2026-10-20"),
    },
    recorder.db,
  );

  assert.equal(moved.notice, null);
  assert.equal(moved.status, TradieScheduleStatus.CONFIRMED);
  assert.ok(!("status" in (scheduleWrite(recorder)?.data ?? {})));
});

test("refusals write nothing", async () => {
  const cases: {
    readonly name: string;
    readonly status: TradieScheduleStatus;
    readonly input: Partial<Parameters<typeof rescheduleTradieSchedule>[1]>;
    readonly error: new (...args: never[]) => Error;
  }[] = [
    {
      name: "declined",
      status: TradieScheduleStatus.DECLINED,
      input: {},
      error: DomainTransitionError,
    },
    {
      name: "completed",
      status: TradieScheduleStatus.COMPLETED,
      input: {},
      error: DomainTransitionError,
    },
    {
      // The dialog chose its email from the status it opened on; a reply
      // landing in between would make that the wrong email.
      name: "status moved since the dialog opened",
      status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
      input: { expectedStatus: TradieScheduleStatus.PENDING },
      error: DomainStaleVersionError,
    },
    {
      name: "nothing changes",
      status: TradieScheduleStatus.PENDING,
      input: { scheduledDate: day("2026-10-20") },
      error: DomainValidationError,
    },
  ];

  for (const { name, status, input, error } of cases) {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieSchedule.findUnique": booking(status),
    });
    await assert.rejects(
      rescheduleTradieSchedule(
        adminPrincipal(),
        { scheduleId: "s_1", scheduledDate: day("2026-10-21"), ...input },
        recorder.db,
      ),
      error,
      name,
    );
    assert.deepEqual(recorder.writes(), [], name);
  }
});
