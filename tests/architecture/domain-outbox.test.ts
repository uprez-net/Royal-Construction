import assert from "node:assert/strict";
import { OutboxEventKind, OutboxEventStatus } from "@prisma/client";
import { test } from "vitest";

import {
  claimOutboxEvents,
  completeOutboxEvent,
  enqueueOutboxEvent,
  failOutboxEvent,
} from "@/lib/domain/outbox";
import { recordingDb } from "./domain-harness";

test("outbox intent is idempotent and a pending event can be claimed once", async () => {
  const lockedAt = new Date("2026-09-21T10:00:00.000Z");
  const recorder = recordingDb({
    "outboxEvent.upsert": {
      id: "event_1",
      key: "tradie-reminder:schedule_1",
      status: OutboxEventStatus.PENDING,
    },
    "outboxEvent.findMany": [
      {
        attempts: 0,
        availableAt: lockedAt,
        createdAt: lockedAt,
        id: "event_1",
        key: "tradie-reminder:schedule_1",
        kind: OutboxEventKind.TRADIE_SCHEDULE_REMINDER,
        payload: { scheduleId: "schedule_1" },
      },
    ],
    "outboxEvent.updateMany": { count: 1 },
  });

  const intent = await enqueueOutboxEvent(recorder.db, {
    key: "tradie-reminder:schedule_1",
    kind: OutboxEventKind.TRADIE_SCHEDULE_REMINDER,
    payload: { scheduleId: "schedule_1" },
  });
  const claimed = await claimOutboxEvents(recorder.db, { now: lockedAt });

  assert.deepEqual(intent, {
    id: "event_1",
    key: "tradie-reminder:schedule_1",
    status: OutboxEventStatus.PENDING,
  });
  assert.equal(claimed[0]?.attempts, 1);
  assert.deepEqual(claimed[0]?.payload, { scheduleId: "schedule_1" });
});

test("outbox completion and non-retryable failure settle only claimed work", async () => {
  const recorder = recordingDb({ "outboxEvent.updateMany": { count: 1 } });

  await completeOutboxEvent(recorder.db, "event_1", { providerId: "mail_1" });
  await failOutboxEvent(recorder.db, "event_2", {
    message: "Provider accepted the request but the response was lost.",
    retryable: false,
  });

  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["outboxEvent.updateMany", "outboxEvent.updateMany"],
  );
});
