import assert from "node:assert/strict";
import { TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import {
  markTradieReminderSent,
  sendTradieScheduleReminder,
} from "@/lib/domain/tradies/reminders";
import { adminPrincipal, recordingDb } from "./domain-harness";

test("tradie reminder completion advances a confirmed schedule once", async () => {
  const sentAt = new Date("2026-09-21T10:00:00.000Z");
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      reminderSentAt: null,
      status: TradieScheduleStatus.CONFIRMED,
    },
    "tradieSchedule.updateMany": { count: 1 },
  });

  const result = await markTradieReminderSent(
    "schedule_1",
    recorder.db,
    sentAt,
  );

  assert.deepEqual(result, {
    alreadySent: false,
    status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
  });
  assert.deepEqual((recorder.writes()[0]?.args as { data: unknown }).data, {
    reminderSentAt: sentAt,
    status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
  });
});

test("manual tradie reminders persist their provider attempt before sending", async () => {
  let sent = 0;
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      tradie: { email: "tradie@example.com" },
    },
    "outboxEvent.upsert": {
      id: "event_1",
      key: "tradie-manual-reminder:2026-09-21:request_1",
      result: null,
      status: "PENDING",
    },
    "outboxEvent.findUnique": (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if ("key" in where) {
        return {
          attempts: 0,
          id: "event_1",
          key: "tradie-manual-reminder:2026-09-21:request_1",
          kind: "TRADIE_SCHEDULE_MANUAL_REMINDER",
          payload: {},
          status: "PENDING",
        };
      }
      return { tradie: { email: "tradie@example.com" } };
    },
    "outboxEvent.updateMany": { count: 1 },
  });

  const result = await sendTradieScheduleReminder(
    adminPrincipal(),
    {
      body: "Please confirm the booking.",
      idempotencyKey: "request_1",
      now: new Date("2026-09-21T09:00:00.000Z"),
      scheduleId: "schedule_1",
      subject: "Booking confirmation",
    },
    recorder.db,
    async () => {
      sent += 1;
    },
  );

  assert.deepEqual(result, {
    alreadySent: false,
    to: "tradie@example.com",
  });
  assert.equal(sent, 1);
  assert.equal(recorder.writes().length, 3);

  // The key is scoped to the day it was used. The modal builds the subject and
  // body deterministically from the schedule, so an unscoped content key made
  // every later resend of the same reminder a permanent no-op.
  const upsert = recorder
    .writes()
    .find((write) => write.operation === "outboxEvent.upsert");
  assert.match(
    (upsert?.args as { where: { key: string } }).where.key,
    /^tradie-manual-reminder:2026-09-21:request_1$/,
  );
});

test("a reminder already sent today is reported as a replay, not a fresh send", async () => {
  let sent = 0;
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      tradie: { email: "tradie@example.com" },
    },
    // The intent is already SUCCEEDED, so the provider must not be called
    // again — but the caller has to be told, or it reports a send that never
    // happened.
    "outboxEvent.upsert": {
      id: "event_1",
      key: "tradie-manual-reminder:2026-09-21:request_1",
      result: { to: "tradie@example.com" },
      status: "SUCCEEDED",
    },
  });

  const result = await sendTradieScheduleReminder(
    adminPrincipal(),
    {
      body: "Please confirm the booking.",
      idempotencyKey: "request_1",
      now: new Date("2026-09-21T09:00:00.000Z"),
      scheduleId: "schedule_1",
      subject: "Booking confirmation",
    },
    recorder.db,
    async () => {
      sent += 1;
    },
  );

  assert.deepEqual(result, { alreadySent: true, to: "tradie@example.com" });
  assert.equal(sent, 0);
});
