import assert from "node:assert/strict";

import { TradieScheduleStatus } from "@prisma/client";
import { afterEach, test, vi } from "vitest";
import { ZodError } from "zod";

import {
  noteTradieActivity,
  recordTradieActivity,
} from "@/lib/domain/audit/tradie-activity-log";
import { systemPrincipal } from "@/lib/domain/principal";
import { listTradieActivity } from "@/lib/domain/tradies/queries";
import {
  createTradieSchedule,
  transitionTradieSchedule,
} from "@/lib/domain/tradies/schedules";
import {
  createTradieActivityLogEntry,
  tradieActivityLogTemplates,
} from "@/types/tradieActivityLog";
import { tradieActivityLogSchemas } from "@/utils/validators/tradieActivityLog";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// A tradie's history across every project, built like notifications and the
// project activity log: a schema and a template per type, one generator. What
// matters most is that it is written wherever the change happens — the screen,
// Eve, the email-reply webhook, a cron — and that a failed write can neither
// hide a rolled-back change nor turn a sent email into an error.

afterEach(() => {
  vi.restoreAllMocks();
});

const BOOKING = {
  milestoneId: "m_1",
  projectId: "p_1",
  scheduleId: "s_1",
  tradieId: "t_1",
};

test("every activity type has both a schema and a template", () => {
  assert.deepEqual(
    Object.keys(tradieActivityLogTemplates).sort(),
    Object.keys(tradieActivityLogSchemas).sort(),
  );
});

test("the generator validates and renders an entry linked to its booking", () => {
  const quote = createTradieActivityLogEntry("bookingCreated", {
    ...BOOKING,
    asksForQuote: true,
    durationDays: 3,
    scheduledDate: "2026-11-03",
    trade: "Plumbing",
  });
  assert.equal(quote.type, "bookingCreated");
  assert.equal(
    quote.message,
    "Asked to quote for Plumbing · starts Tue, 3 Nov 2026 · 3 days",
  );
  assert.equal(quote.scheduleId, "s_1");
  assert.equal(quote.projectId, "p_1");
  assert.match(quote.id, /^[0-9a-f-]{36}$/);

  const reply = createTradieActivityLogEntry("bookingStatusChanged", {
    ...BOOKING,
    from: TradieScheduleStatus.PENDING,
    quote: "$4,500.00",
    to: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    via: "graph:tradie-email-reply",
  });
  assert.equal(
    reply.message,
    "Booking moved from waiting on the tradie to availability confirmed, awaiting admin approval · quoted $4,500.00 — from the tradie's emailed reply",
  );

  assert.throws(
    () =>
      createTradieActivityLogEntry("bookingCreated", {
        ...BOOKING,
        asksForQuote: true,
        durationDays: 0,
        scheduledDate: "2026-11-03",
        trade: "Plumbing",
      }),
    ZodError,
  );
});

test("an entry is attributed to the person, and to nobody for the system", async () => {
  const recorder = recordingDb();
  await recordTradieActivity(
    {
      data: { incidentType: "SAFETY", severity: "HIGH", tradieId: "t_1" },
      principal: adminPrincipal("user_7"),
      type: "incidentReported",
    },
    recorder.db,
  );
  await recordTradieActivity(
    {
      data: { ...BOOKING, reason: "the activity was marked done" },
      principal: systemPrincipal("cron"),
      type: "bookingCompleted",
    },
    recorder.db,
  );
  const rows = recorder
    .writes()
    .map((call) => (call.args as { data: Record<string, unknown> }).data);
  assert.equal(rows[0].authorId, "user_7");
  assert.equal(rows[0].projectId, null);
  assert.equal(rows[0].message, "Incident reported: safety, high severity");
  assert.equal(rows[1].authorId, null);
  assert.equal(rows[1].scheduleId, "s_1");
});

test("a payload that fails its schema is skipped, never stopping the change it describes", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const recorder = recordingDb();
  await recordTradieActivity(
    {
      data: { ...BOOKING, reason: "" },
      principal: null,
      type: "bookingCancelled",
    },
    recorder.db,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("inside a transaction a failed write fails the change; after an email it never throws", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const failing = recordingDb({
    "tradieActivityLog.create": () => {
      throw new Error("connection reset");
    },
  });
  const write = {
    data: { incidentType: "SAFETY", severity: "LOW", tradieId: "t_1" },
    principal: null,
    type: "incidentReported" as const,
  };
  await assert.rejects(
    recordTradieActivity(write, failing.db),
    /connection reset/,
  );
  await noteTradieActivity(write, failing.db);
});

// ---------------------------------------------------------------------------
// Written where the change happens
// ---------------------------------------------------------------------------

function logged(recorder: ReturnType<typeof recordingDb>) {
  return recorder
    .writes()
    .filter((call) => call.operation === "tradieActivityLog.create")
    .map((call) => (call.args as { data: Record<string, unknown> }).data);
}

test("booking a tradie records it on their history, in the same transaction", async () => {
  const recorder = recordingDb({
    "milestone.findFirst": { id: "m_1" },
    "project.findUnique": { id: "p_1", name: "House", siteManagerId: null },
    "tradie.findUnique": {
      archivedAt: null,
      id: "t_1",
      name: "Sam",
      trade: "Electrical",
      trades: ["Electrical"],
    },
    "tradieSchedule.create": (args: unknown) => ({
      ...(args as { data: Record<string, unknown> }).data,
      id: "s_new",
    }),
    "tradieSchedule.findFirst": null,
  });
  await createTradieSchedule(
    adminPrincipal(),
    {
      durationDays: 2,
      milestoneId: "m_1",
      projectId: "p_1",
      requiresQuote: false,
      scheduledDate: new Date("2026-11-03T00:00:00.000Z"),
      tradieId: "t_1",
    },
    recorder.db,
  );
  const [entry] = logged(recorder);
  assert.equal(entry.type, "bookingCreated");
  assert.equal(entry.scheduleId, "s_new");
  assert.equal(
    entry.message,
    "Booked directly for Electrical · starts Tue, 3 Nov 2026 · 2 days",
  );
  // After the booking, so a refused booking leaves no history behind.
  const operations = recorder.writes().map((call) => call.operation);
  assert.deepEqual(operations, [
    "tradieSchedule.create",
    "tradieActivityLog.create",
  ]);
});

test("a tradie's emailed reply is recorded as coming from the reply, by nobody", async () => {
  const tradie = {
    archivedAt: null,
    id: "t_1",
    lastQuotedPrice: 100,
    lastQuotedPriceUnit: "HOURLY",
    name: "Sam",
    trade: "Electrical",
  };
  const project = { id: "p_1", name: "House", siteManagerId: null };
  const recorder = recordingDb({
    "project.findUnique": project,
    "tradieApproval.create": { id: "a_1" },
    "tradieSchedule.findUnique": {
      durationDays: 2,
      id: "s_1",
      milestone: null,
      milestoneId: null,
      project,
      projectId: "p_1",
      quotedPrice: null,
      scheduledDate: new Date("2026-10-14T00:00:00Z"),
      status: TradieScheduleStatus.PENDING_RESPONSE,
      trade: null,
      tradie,
      tradieId: "t_1",
    },
  });
  await transitionTradieSchedule(
    systemPrincipal("graph:tradie-email-reply"),
    {
      scheduleId: "s_1",
      toStatus: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    },
    recorder.db,
  );
  const [entry] = logged(recorder);
  assert.equal(entry.authorId, null);
  assert.match(String(entry.message), /from the tradie's emailed reply$/);
});

// ---------------------------------------------------------------------------
// Reading it
// ---------------------------------------------------------------------------

const ROW = (id: string, project: Record<string, unknown> | null) => ({
  author: { name: "Office" },
  createdAt: new Date("2026-10-20T01:00:00.000Z"),
  id,
  message: `Entry ${id}`,
  milestone: project ? { name: "Framing" } : null,
  project,
  scheduleId: null,
  type: "bookingCreated",
});

test("the log pages newest first, and names only projects the reader may manage", async () => {
  const mine = { id: "p_mine", name: "Smith", siteManagerId: "user_sm" };
  const theirs = { id: "p_other", name: "Jones", siteManagerId: "user_x" };
  const recorder = recordingDb({
    "tradieActivityLog.findMany": [
      ROW("l_3", mine),
      ROW("l_2", theirs),
      ROW("l_1", null),
    ],
  });
  const page = await listTradieActivity(
    siteManagerPrincipal("user_sm"),
    { limit: 2, tradieId: "t_1" },
    recorder.db,
  );
  assert.deepEqual(
    page.items.map((item) => item.project?.name ?? null),
    ["Smith", null],
  );
  // The other site manager's job: what happened, not whose build it was.
  assert.equal(page.items[1].milestoneName, null);
  assert.equal(page.items[1].message, "Entry l_2");
  // A third row came back, so there is an older page, starting after l_2.
  assert.equal(page.nextCursor, "l_2");
  const args = recorder.calls[0].args as {
    orderBy: unknown;
    take: number;
    where: unknown;
  };
  assert.deepEqual(args.where, { tradieId: "t_1" });
  assert.equal(args.take, 3);
});
