import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  MilestoneStatus as MS,
  ProjectStatus as PS,
  TradieScheduleStatus as TS,
} from "@prisma/client";

import {
  assessProjectAttention,
  overdueCandidateWhere,
  type AttentionSource,
} from "@/lib/domain/projects/attention";
import {
  isProjectOverdue,
  overdueLateness,
} from "@/lib/domain/projects/overdue";
import {
  bookingGapLabel,
  bookingsDue,
  overdueMilestoneBookings,
} from "@/lib/domain/projects/tradie-dependencies";

// A tradie is booked before the activity starts, so an activity's bookings are
// overdue from its start day: under way, or pending on a job being built with
// its planned start arrived, without a confirmed booking for each trade it
// needs, or with a tradie booked who has not confirmed.

const TODAY = new Date(2026, 10, 26, 9);
const yesterday = new Date(2026, 10, 25);
const tomorrow = new Date(2026, 10, 27);

const trades = (gaps: { trade: string }[]) => gaps.map((gap) => gap.trade);

describe("overdueMilestoneBookings", () => {
  const milestone: {
    id: string;
    status: MS;
    targetDate: Date;
    requiredTradeTypes: { label: string }[];
  } = {
    id: "a",
    status: MS.ACTIVE,
    targetDate: yesterday,
    requiredTradeTypes: [{ label: "Plumbing" }],
  };
  const booking = {
    milestoneId: "a",
    status: TS.CONFIRMED,
    tradie: { trade: "Plumbing" },
  };
  const gaps = (
    bookings: Parameters<typeof overdueMilestoneBookings>[1],
    overrides: Partial<typeof milestone> = {},
    projectStatus: PS = PS.ACTIVE,
  ) =>
    overdueMilestoneBookings(
      { ...milestone, ...overrides },
      bookings,
      TODAY,
      projectStatus,
    );

  test("only a confirmed booking in the right category on this activity clears it", () => {
    assert.deepEqual(gaps([]), [{ trade: "Plumbing", unconfirmed: false }]);
    for (const status of [
      TS.PENDING,
      TS.AWAITING_QUOTE,
      TS.PENDING_RESPONSE,
      TS.QUOTE_RECEIVED,
      TS.AWAITING_ADMIN_APPROVAL,
      TS.PENDING_FINAL_CONFIRMATION,
      TS.NO_RESPONSE,
    ]) {
      assert.deepEqual(gaps([{ ...booking, status }]), [
        { trade: "Plumbing", unconfirmed: true },
      ]);
    }
    // Over, so nobody is booked any more.
    for (const status of [TS.DECLINED, TS.CANCELLED]) {
      assert.deepEqual(gaps([{ ...booking, status }]), [
        { trade: "Plumbing", unconfirmed: false },
      ]);
    }
    assert.deepEqual(trades(gaps([{ ...booking, milestoneId: "b" }])), [
      "Plumbing",
    ]);
    assert.deepEqual(
      trades(gaps([{ ...booking, tradie: { trade: "Electrical" } }])),
      ["Plumbing"],
    );
    assert.deepEqual(gaps([booking]), []);
    // The same trade as a request would accept it, whatever the case.
    assert.deepEqual(
      gaps([{ ...booking, tradie: { trade: " plumbing " } }]),
      [],
    );
  });

  test("an activity needing two trades is overdue for each until both are confirmed", () => {
    const two = {
      requiredTradeTypes: [{ label: "Plumbing" }, { label: "Electrical" }],
    };
    const electrician = { ...booking, tradie: { trade: "Electrical" } };
    assert.deepEqual(trades(gaps([], two)), ["Plumbing", "Electrical"]);
    assert.deepEqual(trades(gaps([booking], two)), ["Electrical"]);
    assert.deepEqual(gaps([booking, electrician], two), []);
  });

  test("a tradie booked for a trade the activity does not list is overdue while unconfirmed", () => {
    const tiler = {
      ...booking,
      status: TS.PENDING_RESPONSE,
      tradie: { trade: "Tiling" },
    };
    assert.deepEqual(gaps([tiler], { requiredTradeTypes: [] }), [
      { trade: "Tiling", unconfirmed: true },
    ]);
    // Another tiler confirmed covers it.
    assert.deepEqual(
      gaps([tiler, { ...tiler, status: TS.CONFIRMED }], {
        requiredTradeTypes: [],
      }),
      [],
    );
    // Listed once even with two unconfirmed tilers.
    assert.equal(gaps([tiler, tiler], { requiredTradeTypes: [] }).length, 1);
  });

  test("a pending activity is due on its planned start day on a job being built", () => {
    const pending = { status: MS.PENDING };
    assert.deepEqual(trades(gaps([], { ...pending, targetDate: yesterday })), [
      "Plumbing",
    ]);
    // The day itself: the booking had to be confirmed before work began.
    assert.deepEqual(
      trades(gaps([], { ...pending, targetDate: new Date(2026, 10, 26) })),
      ["Plumbing"],
    );
    assert.deepEqual(gaps([], { ...pending, targetDate: tomorrow }), []);
    // Drafting or compliance: the planned dates are not real yet.
    for (const status of [
      PS.DRAFT,
      PS.COMPLIANCE_STARTED,
      PS.COMPLIANCE_COMPLETED,
      PS.COMPLETED,
    ]) {
      assert.deepEqual(
        gaps([], { ...pending, targetDate: yesterday }, status),
        [],
      );
    }
  });

  test("an activity under way is due whatever the project status says", () => {
    assert.ok(bookingsDue(milestone, TODAY, PS.DRAFT));
    assert.deepEqual(trades(gaps([], { targetDate: tomorrow }, PS.DRAFT)), [
      "Plumbing",
    ]);
  });

  test("a finished or waived activity owes nothing", () => {
    for (const status of [MS.DONE, MS.NOT_REQUIRED]) {
      assert.deepEqual(gaps([], { status }), []);
    }
  });

  test("labels say whether anybody is booked", () => {
    assert.equal(
      bookingGapLabel({ trade: "Plumbing", unconfirmed: false }),
      "No confirmed Plumbing booking",
    );
    assert.equal(
      bookingGapLabel({ trade: "Plumbing", unconfirmed: true }),
      "Plumbing booked, not confirmed",
    );
  });
});

// 9am Sydney on Thu 26 Nov 2026 (AEDT, UTC+11).
const NOW = new Date("2026-11-25T22:00:00Z");
// Sydney midnight on a given November day.
const sydneyDay = (day: number) =>
  new Date(Date.UTC(2026, 10, day - 1, 13, 0, 0));

function source(overrides: Partial<AttentionSource> = {}): AttentionSource {
  return {
    id: "p1",
    name: "Smith residence",
    location: "1 Example St",
    status: "ACTIVE",
    requirements: {
      legalAdministration: {
        signedDate: "2026-10-01",
        pcaInspector: "Jane Certifier",
        hbcfInsuranceNumber: "HBCF-1",
      },
    },
    customer: { name: "Sam Smith" },
    milestones: [],
    tradieSchedules: [],
    variations: [],
    checklists: [],
    certifierEngagement: {
      alerts: [],
      documents: [
        { documentType: "CONSTRUCTION_CERTIFICATE", _count: { files: 1 } },
        { documentType: "HOME_INSURANCE", _count: { files: 1 } },
      ],
    },
    ...overrides,
  };
}

const activity = (
  overrides: Partial<AttentionSource["milestones"][number]> = {},
): AttentionSource["milestones"][number] => ({
  id: "m1",
  name: "Framing",
  status: "PENDING",
  targetDate: sydneyDay(23),
  startDate: null,
  estimatedDays: 5,
  requiredTradeTypes: [{ label: "Carpentry" }],
  ...overrides,
});

describe("Overdue on the Projects list", () => {
  test("a pending activity past its planned start without a confirmed booking makes the project overdue", () => {
    const attention = assessProjectAttention(
      source({ milestones: [activity()] }),
      NOW,
    );
    assert.equal(attention.overdue.length, 0);
    assert.deepEqual(
      attention.overdueBookings.map((booking) => ({
        trade: booking.trade,
        unconfirmed: booking.unconfirmed,
        started: booking.started,
        daysLate: booking.daysLate,
      })),
      [{ trade: "Carpentry", unconfirmed: false, started: false, daysLate: 3 }],
    );
    assert.ok(isProjectOverdue(attention));
    assert.equal(overdueLateness(attention), 3);
    const [condition] = attention.conditions;
    assert.equal(condition.kind, "DEPENDENCY");
    assert.equal(
      condition.label,
      "No confirmed Carpentry booking for Framing, due to start 23 Nov",
    );
  });

  test("a booked tradie who has not confirmed is overdue on the start day", () => {
    const attention = assessProjectAttention(
      source({
        milestones: [activity({ targetDate: sydneyDay(26) })],
        tradieSchedules: [
          {
            milestoneId: "m1",
            status: "PENDING_RESPONSE",
            trade: "Carpentry",
            tradie: { trade: "Carpentry" },
          },
        ],
      }),
      NOW,
    );
    assert.equal(attention.overdueBookings[0]?.unconfirmed, true);
    assert.equal(attention.overdueBookings[0]?.daysLate, 0);
    assert.equal(
      attention.conditions[0]?.label,
      "Carpentry booked, not confirmed for Framing, which starts today",
    );
  });

  test("a confirmed booking, or a start still to come, is not overdue", () => {
    const confirmed = assessProjectAttention(
      source({
        milestones: [activity()],
        tradieSchedules: [
          {
            milestoneId: "m1",
            status: "CONFIRMED",
            trade: "Carpentry",
            tradie: { trade: "Carpentry" },
          },
        ],
      }),
      NOW,
    );
    assert.ok(!isProjectOverdue(confirmed));
    const later = assessProjectAttention(
      source({ milestones: [activity({ targetDate: sydneyDay(27) })] }),
      NOW,
    );
    assert.ok(!isProjectOverdue(later));
  });

  test("a job in compliance is never overdue on planned dates", () => {
    const attention = assessProjectAttention(
      source({ status: "COMPLIANCE_STARTED", milestones: [activity()] }),
      NOW,
    );
    assert.ok(!isProjectOverdue(attention));
  });

  test("an activity past its estimated end is overdue as before", () => {
    const attention = assessProjectAttention(
      source({
        milestones: [
          activity({
            status: "ACTIVE",
            startDate: sydneyDay(10),
            requiredTradeTypes: [],
          }),
        ],
      }),
      NOW,
    );
    assert.equal(attention.overdueBookings.length, 0);
    assert.ok(isProjectOverdue(attention));
    assert.equal(overdueLateness(attention), attention.overdue[0]?.daysOverdue);
  });

  test("the candidate query is a superset: an activity under way, or a pending one starting before now + 1 day", () => {
    const where = overdueCandidateWhere(NOW);
    assert.deepEqual(where.OR?.[0], {
      milestones: { some: { status: "ACTIVE" } },
    });
    const pending = where.OR?.[1] as {
      milestones: { some: { targetDate: { lt: Date } } };
    };
    // The latest start that can be due today in Sydney is earlier than this.
    assert.ok(
      pending.milestones.some.targetDate.lt.getTime() > sydneyDay(27).getTime(),
    );
  });
});
