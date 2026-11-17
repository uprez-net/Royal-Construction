import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  addCalendarDays,
  calendarDaysBetween,
  compareNeedsDecision,
  dueFields,
  isDueThisWeek,
  oldestWaiting,
  type DueSubject,
  type Queued,
} from "@/lib/tradie-approvals/queue-order";

const TODAY = "2026-11-17";
const SUBMITTED = new Date("2026-11-01T01:00:00.000Z"); // 1 Nov Sydney

function subject(
  overrides: Partial<DueSubject> & Pick<DueSubject, "actionType">,
): DueSubject {
  return {
    id: "a",
    createdAt: SUBMITTED,
    updationData: null,
    ...overrides,
  };
}

// A Sydney start-of-day booking is the previous UTC date: 20 Nov AEDT is 19 Nov 13:00Z.
const BOOKING_20_NOV_SYDNEY = "2026-11-19T13:00:00.000Z";

describe("decisionDue per action type", () => {
  test("SCHEDULE_APPROVAL and SCHEDULE_DELETION use the booking's Sydney date", () => {
    for (const actionType of [
      "SCHEDULE_APPROVAL",
      "SCHEDULE_DELETION",
    ] as const) {
      const due = dueFields(
        subject({
          actionType,
          updationData: { scheduledDate: BOOKING_20_NOV_SYDNEY },
        }),
        TODAY,
        null,
      );
      assert.deepEqual(due, {
        decisionDue: "2026-11-20",
        dueKind: "booking",
        overdue: false,
      });
    }
  });

  test("a missing or unparseable booking date falls back to the submitted date", () => {
    for (const updationData of [null, {}, { scheduledDate: "not a date" }]) {
      const due = dueFields(
        subject({ actionType: "SCHEDULE_DELETION", updationData }),
        TODAY,
        null,
      );
      assert.deepEqual(due, {
        decisionDue: "2026-11-01",
        dueKind: "submitted",
        overdue: false,
      });
    }
  });

  test("TRADE_CANCELLATION uses the earliest open booking, else the submitted date", () => {
    const open = dueFields(
      subject({ actionType: "TRADE_CANCELLATION" }),
      TODAY,
      "2026-11-25",
    );
    assert.deepEqual(open, {
      decisionDue: "2026-11-25",
      dueKind: "booking",
      overdue: false,
    });

    const none = dueFields(
      subject({ actionType: "TRADE_CANCELLATION" }),
      TODAY,
      null,
    );
    assert.deepEqual(none, {
      decisionDue: "2026-11-01",
      dueKind: "submitted",
      overdue: false,
    });
  });

  test("other types use the submitted date, whatever the payload says", () => {
    for (const actionType of [
      "PRICE_CHANGE",
      "INCIDENT_RESOLUTION",
      "TRADIE_REMOVAL",
    ] as const) {
      const due = dueFields(
        subject({
          actionType,
          updationData: { scheduledDate: BOOKING_20_NOV_SYDNEY },
        }),
        TODAY,
        "2026-11-20",
      );
      assert.deepEqual(due, {
        decisionDue: "2026-11-01",
        dueKind: "submitted",
        overdue: false,
      });
    }
  });
});

describe("overdue", () => {
  test("a booking due the day before today is overdue", () => {
    const due = dueFields(
      subject({ actionType: "TRADE_CANCELLATION" }),
      TODAY,
      "2026-11-16",
    );
    assert.equal(due.overdue, true);
  });

  test("a booking due exactly today is not overdue", () => {
    const due = dueFields(
      subject({ actionType: "TRADE_CANCELLATION" }),
      TODAY,
      TODAY,
    );
    assert.equal(due.overdue, false);
    assert.equal(due.dueKind, "booking");
  });

  test("a submitted-date request is never overdue, however old", () => {
    const due = dueFields(
      subject({
        actionType: "PRICE_CHANGE",
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
      TODAY,
      null,
    );
    assert.equal(due.overdue, false);
  });
});

describe("calendar arithmetic", () => {
  test("adds days across month and year ends", () => {
    assert.equal(addCalendarDays("2026-11-17", 7), "2026-11-24");
    assert.equal(addCalendarDays("2026-12-28", 7), "2027-01-04");
    assert.equal(addCalendarDays("2026-02-24", 7), "2026-03-03");
    assert.equal(addCalendarDays("2026-10-01", 7), "2026-10-08");
  });

  test("counts calendar days between dates", () => {
    assert.equal(calendarDaysBetween("2026-11-01", "2026-11-17"), 16);
    assert.equal(calendarDaysBetween("2026-11-17", "2026-11-17"), 0);
  });
});

describe("due this week", () => {
  const row = (dueKind: "booking" | "submitted", decisionDue: string) => ({
    dueKind,
    decisionDue,
    overdue: false,
  });

  test("includes today + 7 and overdue, excludes today + 8", () => {
    assert.equal(isDueThisWeek(row("booking", "2026-11-24"), TODAY), true);
    assert.equal(isDueThisWeek(row("booking", "2026-11-18"), TODAY), true);
    assert.equal(isDueThisWeek(row("booking", "2026-11-10"), TODAY), true);
    assert.equal(isDueThisWeek(row("booking", "2026-11-25"), TODAY), false);
  });

  test("a submitted-date request is never due this week", () => {
    assert.equal(isDueThisWeek(row("submitted", "2026-11-10"), TODAY), false);
  });
});

describe("needs-decision order", () => {
  function queued(id: string, decisionDue: string, createdAt: string): Queued {
    return {
      id,
      decisionDue,
      dueKind: "booking",
      overdue: decisionDue < TODAY,
      createdAt: new Date(createdAt),
    };
  }

  test("sorts by decisionDue, so overdue comes first", () => {
    const rows = [
      queued("future", "2026-12-01", "2026-11-01T00:00:00.000Z"),
      queued("overdue", "2026-11-10", "2026-11-05T00:00:00.000Z"),
      queued("today", "2026-11-17", "2026-11-02T00:00:00.000Z"),
    ].sort(compareNeedsDecision);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["overdue", "today", "future"],
    );
  });

  test("breaks a tie on decisionDue by createdAt, oldest first", () => {
    const rows = [
      queued("newer", "2026-11-20", "2026-11-10T00:00:00.000Z"),
      queued("older", "2026-11-20", "2026-11-03T00:00:00.000Z"),
    ].sort(compareNeedsDecision);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["older", "newer"],
    );
  });

  test("breaks a full tie on id so the order is stable", () => {
    const rows = [
      queued("b", "2026-11-20", "2026-11-03T00:00:00.000Z"),
      queued("a", "2026-11-20", "2026-11-03T00:00:00.000Z"),
    ].sort(compareNeedsDecision);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["a", "b"],
    );
  });
});

describe("oldest waiting", () => {
  test("names the oldest request and its age in Sydney days", () => {
    const result = oldestWaiting(
      [
        {
          id: "new",
          actionType: "PRICE_CHANGE",
          createdAt: new Date("2026-11-15T00:00:00.000Z"),
        },
        {
          id: "old",
          actionType: "TRADE_CANCELLATION",
          createdAt: new Date("2026-11-01T01:00:00.000Z"),
        },
      ],
      TODAY,
    );
    assert.deepEqual(result, {
      approvalId: "old",
      actionType: "TRADE_CANCELLATION",
      days: 16,
    });
  });

  test("is null when nothing is waiting", () => {
    assert.equal(oldestWaiting([], TODAY), null);
  });
});
