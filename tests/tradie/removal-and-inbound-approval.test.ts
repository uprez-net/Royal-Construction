import assert from "node:assert/strict";
import { test } from "vitest";
import { TradieApprovalActionType, TradieScheduleStatus } from "@prisma/client";
import { resolveTradieApproval } from "@/lib/domain/tradies/approvals";
import { requestTradieRemoval } from "@/lib/domain/tradies/directory";
import {
  getTradieRemovalImpact,
  searchTradies,
} from "@/lib/domain/tradies/queries";
import {
  createTradieSchedule,
  rescheduleTradieSchedule,
  transitionTradieSchedule,
} from "@/lib/domain/tradies/schedules";
import {
  sendTradieScheduleReminder,
  findTradieReminderWindow,
} from "@/lib/domain/tradies/reminders";
import {
  DomainAuthorizationError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { systemPrincipal, anonymousPrincipal } from "@/lib/domain/principal";
import type { DomainDb } from "@/lib/domain/db";
import { tradieScheduleSpend } from "@/lib/domain/tradies/lifecycle";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "../architecture/domain-harness";

const tradie = {
  id: "t_1",
  name: "Sam",
  trade: "Electrical",
  archivedAt: null,
  lastQuotedPrice: 100,
  lastQuotedPriceUnit: "HOURLY",
};
const project = { id: "p_1", name: "House", siteManagerId: null };
const schedule = {
  id: "s_1",
  tradieId: tradie.id,
  projectId: project.id,
  milestoneId: null,
  scheduledDate: new Date("2026-10-14T00:00:00Z"),
  durationDays: 2,
  status: TradieScheduleStatus.PENDING_RESPONSE,
  quotedPrice: null,
  tradie,
  project,
};
const removal = {
  id: "a_1",
  actionType: TradieApprovalActionType.TRADIE_REMOVAL,
  tradieId: tradie.id,
  tradie,
  updationData: null,
};

test("cancelled bookings contribute no spend while completed quoted and hourly work retains its cost", () => {
  const priced = {
    ...schedule,
    tradie: { lastQuotedPrice: "100", lastQuotedPriceUnit: "HOURLY" as const },
    requiresQuote: true,
    quotedPrice: "950.00",
  };
  assert.equal(
    tradieScheduleSpend({ ...priced, status: TradieScheduleStatus.CANCELLED }),
    0,
  );
  assert.equal(
    tradieScheduleSpend({ ...priced, status: TradieScheduleStatus.COMPLETED }),
    950,
  );
  // Hourly work with no price recorded is costed from the tradie's rate.
  assert.equal(
    tradieScheduleSpend({
      ...priced,
      quotedPrice: null,
      requiresQuote: false,
      status: TradieScheduleStatus.COMPLETED,
    }),
    1600,
  );
  // A tradie booked without a quote, whose price the office then recorded,
  // costs that price.
  assert.equal(
    tradieScheduleSpend({
      ...priced,
      requiresQuote: false,
      status: TradieScheduleStatus.COMPLETED,
    }),
    950,
  );
  // Still waiting on a quote: nothing yet.
  assert.equal(
    tradieScheduleSpend({
      ...priced,
      quotedPrice: null,
      status: TradieScheduleStatus.AWAITING_QUOTE,
    }),
    0,
  );
});

test("approved removal archives identity and cancels only unfinished bookings, retaining all history", async () => {
  const recorder = recordingDb({
    "tradieApproval.findUnique": removal,
    "tradieSchedule.findMany": [
      { id: "s_1", projectId: "p_1" },
      { id: "s_2", projectId: "p_1" },
    ],
    "tradieSchedule.updateMany": { count: 2 },
  });
  const result = await resolveTradieApproval(
    adminPrincipal(),
    {
      approvalId: "a_1",
      resolution: "approved",
      reviewedBookingIds: ["s_2", "s_1"],
    },
    recorder.db,
  );
  assert.deepEqual(result.affected, {
    archived: true,
    cancelledSchedules: 2,
    // Any trade the tradie held is released with them.
    endedSelections: 1,
    projectIds: ["p_1"],
  });
  assert.ok(
    recorder.writes().every((call) => !call.operation.includes("delete")),
  );
  const cancellation = recorder.calls.find(
    (call) => call.operation === "tradieSchedule.updateMany",
  )?.args as {
    where: { status: { notIn: string[] }; tradieId: string };
    data: unknown;
  };
  assert.equal(cancellation.where.tradieId, "t_1");
  assert.deepEqual(cancellation.where.status.notIn, [
    "DECLINED",
    "COMPLETED",
    "CANCELLED",
  ]);
  assert.deepEqual(cancellation.data, { status: "CANCELLED" });
  const closure = recorder
    .writes()
    .filter((call) => call.operation === "tradieApproval.updateMany")[1]
    .args as {
    data: { status: string; pendingDeletionKey: unknown };
    where: { actionType: unknown };
  };
  assert.equal(closure.data.status, "REJECTED");
  assert.equal(closure.data.pendingDeletionKey, null);
  assert.deepEqual(closure.where.actionType, { not: "INCIDENT_RESOLUTION" });
});

test("a removal approve is refused unless it names the bookings it was shown (#526)", async () => {
  const bookings = [
    { id: "s_1", projectId: "p_1" },
    { id: "s_2", projectId: "p_2" },
  ];
  const attempt = async (reviewedBookingIds?: string[]) => {
    const recorder = recordingDb({
      "tradieApproval.findUnique": removal,
      "tradieSchedule.findMany": bookings,
    });
    const outcome = await resolveTradieApproval(
      adminPrincipal(),
      { approvalId: "a_1", resolution: "approved", reviewedBookingIds },
      recorder.db,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    // Refused inside the transaction, before anything is archived or
    // cancelled: the only write is the claim, which the database rolls back.
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["tradieApproval.updateMany"],
    );
    return outcome;
  };
  // No review: the bulk approve, or a bare server-action call.
  assert.ok((await attempt()) instanceof DomainValidationError);
  // A review from before a booking was added.
  assert.ok((await attempt(["s_1"])) instanceof DomainTransitionError);
  // s_1 done and s_3 added since: the count matches, the bookings do not.
  assert.ok((await attempt(["s_1", "s_3"])) instanceof DomainTransitionError);
});

test("an incident approve is refused without a resolution note (#526)", async () => {
  const recorder = recordingDb({
    "tradieApproval.findUnique": {
      ...removal,
      actionType: TradieApprovalActionType.INCIDENT_RESOLUTION,
      updationData: { incidentId: "i_1" },
    },
  });
  await assert.rejects(
    resolveTradieApproval(
      adminPrincipal(),
      { approvalId: "a_1", resolution: "approved", incidentResolution: "  " },
      recorder.db,
    ),
    DomainValidationError,
  );
});

test("requesting and rejecting removal never change directory or bookings", async () => {
  const request = recordingDb({ "tradie.findUnique": tradie });
  await requestTradieRemoval(
    adminPrincipal(),
    { tradieId: "t_1", reason: "No longer available" },
    request.db,
  );
  assert.deepEqual(
    request.writes().map((call) => call.operation),
    ["tradieApproval.create"],
  );
  const rejected = recordingDb({ "tradieApproval.findUnique": removal });
  await resolveTradieApproval(
    adminPrincipal(),
    { approvalId: "a_1", resolution: "rejected", rejectionReason: "Keep them" },
    rejected.db,
  );
  assert.deepEqual(
    rejected.writes().map((call) => call.operation),
    ["tradieApproval.updateMany"],
  );
});

test("the warning queries all unfinished bookings, including overdue ones, and is admin-only", async () => {
  const recorder = recordingDb({
    "tradie.findUnique": tradie,
    "tradieSchedule.findMany": [
      { ...schedule, scheduledDate: new Date("2026-01-01"), milestone: null },
    ],
  });
  const impact = await getTradieRemovalImpact(
    adminPrincipal(),
    "t_1",
    recorder.db,
  );
  assert.equal(impact.schedules.length, 1);
  const args = recorder.calls.find(
    (call) => call.operation === "tradieSchedule.findMany",
  )?.args as { where: unknown };
  assert.deepEqual(args.where, {
    tradieId: "t_1",
    status: { notIn: ["DECLINED", "COMPLETED", "CANCELLED"] },
  });
  const denied = recordingDb();
  await assert.rejects(
    () => getTradieRemovalImpact(customerPrincipal(), "t_1", denied.db),
    DomainAuthorizationError,
  );
  assert.deepEqual(denied.operations(), []);
});

test("archived tradies stay out of searches and cannot be booked or removed again", async () => {
  const search = recordingDb({ "tradie.findMany": [] });
  await searchTradies(
    adminPrincipal(),
    { query: "", favouriteOnly: false, limit: 20 },
    search.db,
  );
  assert.equal(
    (search.calls[0].args as { where: { archivedAt: unknown } }).where
      .archivedAt,
    null,
  );
  const archived = recordingDb({
    "tradie.findUnique": { ...tradie, archivedAt: new Date() },
    "project.findUnique": project,
  });
  await assert.rejects(
    () =>
      createTradieSchedule(
        adminPrincipal(),
        {
          tradieId: "t_1",
          projectId: "p_1",
          scheduledDate: new Date(),
          durationDays: 1,
          requiresQuote: false,
        },
        archived.db,
      ),
    DomainTransitionError,
  );
  await assert.rejects(
    () =>
      requestTradieRemoval(
        adminPrincipal(),
        { tradieId: "t_1", reason: "Remove" },
        archived.db,
      ),
    DomainTransitionError,
  );
  assert.deepEqual(archived.writes(), []);
});

test("a tradie waiting on removal cannot take new work until it is decided (#529)", async () => {
  const pending = recordingDb({
    "tradie.findUnique": { ...tradie, approvals: [{ id: "a_1" }] },
    "project.findUnique": project,
  });
  await assert.rejects(
    () =>
      createTradieSchedule(
        adminPrincipal(),
        {
          tradieId: "t_1",
          projectId: "p_1",
          scheduledDate: new Date(),
          durationDays: 1,
          requiresQuote: false,
        },
        pending.db,
      ),
    (error: unknown) =>
      error instanceof DomainTransitionError
      && /removal request waiting/.test(error.message),
  );
  assert.deepEqual(pending.writes(), []);
  // The check asks for a pending removal only: a rejected one, or another
  // kind of request, leaves the tradie bookable.
  const read = pending.calls.find(
    (call) => call.operation === "tradie.findUnique",
  )?.args as { include: { approvals: { where: unknown } } };
  assert.deepEqual(read.include.approvals.where, {
    actionType: "TRADIE_REMOVAL",
    status: "PENDING",
  });
});

test("cancelled schedules cannot resume, reschedule, or email a reminder", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      ...schedule,
      status: TradieScheduleStatus.CANCELLED,
    },
    "project.findUnique": project,
  });
  await assert.rejects(
    () =>
      transitionTradieSchedule(
        adminPrincipal(),
        { scheduleId: "s_1", toStatus: TradieScheduleStatus.CONFIRMED },
        recorder.db,
      ),
    DomainTransitionError,
  );
  await assert.rejects(
    () =>
      rescheduleTradieSchedule(
        adminPrincipal(),
        { scheduleId: "s_1", scheduledDate: new Date() },
        recorder.db,
      ),
    DomainTransitionError,
  );
  let sent = false;
  await assert.rejects(
    () =>
      sendTradieScheduleReminder(
        adminPrincipal(),
        {
          scheduleId: "s_1",
          body: "Reminder",
          subject: "Reminder",
          idempotencyKey: "attempt",
        },
        recorder.db,
        async () => {
          sent = true;
        },
      ),
    DomainTransitionError,
  );
  assert.equal(sent, false);
  assert.deepEqual(recorder.writes(), []);
  const worker = recordingDb({
    "tradieSchedule.findMany": [
      {
        ...schedule,
        status: TradieScheduleStatus.CANCELLED,
        reminderSentAt: null,
      },
    ],
  });
  assert.deepEqual(
    (await findTradieReminderWindow(new Date(), new Date(), worker.db))
      .actionable,
    [],
  );
});

test("trusted Graph replies request admin approval with system attribution, without impersonating staff", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findUnique": schedule,
    "project.findUnique": project,
    "tradieApproval.create": { id: "a_2" },
  });
  const result = await transitionTradieSchedule(
    systemPrincipal("graph:tradie-email-reply"),
    {
      scheduleId: "s_1",
      toStatus: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    },
    recorder.db,
  );
  assert.equal(result.approvalId, "a_2");
  assert.equal(result.status, "AWAITING_ADMIN_APPROVAL");
  const data = (
    recorder.calls.find((call) => call.operation === "tradieApproval.create")
      ?.args as {
      data: {
        requestedBy: unknown;
        requestSource: string;
        updationData: { cost: string };
      };
    }
  ).data;
  assert.equal(data.requestedBy, null);
  assert.equal(data.requestSource, "graph:tradie-email-reply");
  assert.equal(data.updationData.cost, "$1,600");
});

test("staff approval requests keep user attribution and anonymous replies cannot mutate anything", async () => {
  const staff = recordingDb({
    "tradieSchedule.findUnique": schedule,
    "project.findUnique": project,
  });
  await transitionTradieSchedule(
    adminPrincipal("u_1"),
    {
      scheduleId: "s_1",
      toStatus: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    },
    staff.db,
  );
  const data = (
    staff.calls.find((call) => call.operation === "tradieApproval.create")
      ?.args as { data: { requestedBy: string; requestSource: unknown } }
  ).data;
  assert.equal(data.requestedBy, "u_1");
  assert.equal(data.requestSource, null);
  const denied = recordingDb({
    "tradieSchedule.findUnique": schedule,
    "project.findUnique": project,
  });
  await assert.rejects(
    () =>
      transitionTradieSchedule(
        anonymousPrincipal("public"),
        {
          scheduleId: "s_1",
          toStatus: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        },
        denied.db,
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(denied.writes(), []);
});

test("status and approval creation share a transaction, so a failed approval cannot strand the booking", async () => {
  const failure = new Error("Database unavailable");
  const recorder = recordingDb({
    "tradieSchedule.findUnique": schedule,
    "project.findUnique": project,
    "tradieApproval.create": () => {
      throw failure;
    },
  });
  let transactionCalled = false;
  let committed = false;
  const db = new Proxy(recorder.db, {
    has: (_target, key) => key === "$transaction",
    get: (target, key) =>
      key === "$transaction"
        ? async (run: (tx: DomainDb) => Promise<unknown>) => {
            transactionCalled = true;
            const result = await run(recorder.db);
            committed = true;
            return result;
          }
        : Reflect.get(target, key),
  });
  await assert.rejects(
    () =>
      transitionTradieSchedule(
        systemPrincipal("graph:tradie-email-reply"),
        {
          scheduleId: "s_1",
          toStatus: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        },
        db,
      ),
    (error) => error === failure,
  );
  assert.equal(transactionCalled, true);
  assert.equal(committed, false);
});
