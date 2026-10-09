import assert from "node:assert/strict";
import { test } from "vitest";
import { MilestoneStatus } from "@prisma/client";
import { milestoneEndDate } from "@/lib/domain/projects/milestone-schedule";
import {
  activeOverdueDays,
  daysLate,
  duenessOf,
} from "@/lib/projects/milestone-ledger";

test("planned starts gain the stored calendar duration, including month boundaries and the legacy default", () => {
  const targetDate = new Date("2026-01-29T09:00:00");
  const original = targetDate.getTime();
  assert.equal(
    milestoneEndDate({ targetDate, estimatedDays: 5 }).getTime(),
    new Date("2026-02-03T09:00:00").getTime(),
  );
  assert.equal(
    milestoneEndDate({ targetDate, startDate: null }).getTime(),
    new Date("2026-02-03T09:00:00").getTime(),
  );
  assert.equal(
    milestoneEndDate({ targetDate, estimatedDays: 1 }).getTime(),
    new Date("2026-01-30T09:00:00").getTime(),
  );
  assert.equal(
    targetDate.getTime(),
    original,
    "deriving an end must preserve the stored start",
  );
});

test("a recorded actual start takes precedence for both Date and serialized API values", () => {
  const targetDate = new Date("2026-01-29T09:00:00");
  const startDate = new Date("2026-02-01T09:00:00");
  const expected = new Date("2026-02-04T09:00:00").getTime();
  assert.equal(
    milestoneEndDate({ targetDate, startDate, estimatedDays: 3 }).getTime(),
    expected,
  );
  assert.equal(
    milestoneEndDate({
      targetDate: targetDate.toISOString(),
      startDate: startDate.toISOString(),
      estimatedDays: 3,
    }).getTime(),
    expected,
  );
});

test("pending work is due at its end rather than already due on its planned start", () => {
  const milestone = { targetDate: "2026-10-09T09:00:00", estimatedDays: 2 };
  assert.deepEqual(duenessOf(milestone, new Date("2026-10-09T16:00:00")), {
    kind: "soon",
    days: 2,
  });
  assert.deepEqual(duenessOf(milestone, new Date("2026-10-11T23:00:00")), {
    kind: "today",
    days: 0,
  });
  assert.deepEqual(duenessOf(milestone, new Date("2026-10-12T01:00:00")), {
    kind: "overdue",
    days: -1,
  });
});

test("due text, the active badge and completion lateness share the actual-start deadline", () => {
  const milestone = {
    status: MilestoneStatus.ACTIVE,
    targetDate: "2026-10-09T09:00:00",
    startDate: "2026-10-12T09:00:00",
    estimatedDays: 3,
  };
  const onEnd = new Date("2026-10-15T23:00:00");
  const afterEnd = new Date("2026-10-16T01:00:00");
  assert.deepEqual(duenessOf(milestone, new Date("2026-10-13T09:00:00")), {
    kind: "soon",
    days: 2,
  });
  assert.deepEqual(duenessOf(milestone, onEnd), { kind: "today", days: 0 });
  assert.equal(activeOverdueDays(milestone, onEnd), null);
  assert.equal(daysLate(milestone, onEnd), 0);
  assert.deepEqual(duenessOf(milestone, afterEnd), {
    kind: "overdue",
    days: -1,
  });
  assert.equal(activeOverdueDays(milestone, afterEnd), 1);
  assert.equal(daysLate(milestone, afterEnd), 1);
});
