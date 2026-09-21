import assert from "node:assert/strict";
import { TradieScheduleStatus } from "@prisma/client";
import { test } from "node:test";

import {
  markTradieReminderSent,
  sendTradieScheduleReminder,
} from "../../lib/domain/tradies/reminders";
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

  const result = await markTradieReminderSent("schedule_1", recorder.db, sentAt);

  assert.deepEqual(result, {
    alreadySent: false,
    status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
  });
  assert.deepEqual(
    (recorder.writes()[0]?.args as { data: unknown }).data,
    {
      reminderSentAt: sentAt,
      status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
    },
  );
});

test("manual tradie reminders persist their provider attempt before sending", async () => {
  let sent = 0;
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      tradie: { email: "tradie@example.com" },
    },
    "outboxEvent.upsert": {
      id: "event_1",
      key: "tradie-manual-reminder:request_1",
      result: null,
      status: "PENDING",
    },
    "outboxEvent.findUnique": (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if ("key" in where) {
        return {
          attempts: 0,
          id: "event_1",
          key: "tradie-manual-reminder:request_1",
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
      scheduleId: "schedule_1",
      subject: "Booking confirmation",
    },
    recorder.db,
    async () => {
      sent += 1;
    },
  );

  assert.deepEqual(result, { to: "tradie@example.com" });
  assert.equal(sent, 1);
  assert.equal(recorder.writes().length, 3);
});
