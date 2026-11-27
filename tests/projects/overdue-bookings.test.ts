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
  BOOKING_LOOKAHEAD_DAYS,
  bookingGapLabel,
  bookingsDue,
  overdueMilestoneBookings,
} from "@/lib/domain/projects/tradie-dependencies";

// A tradie is booked before the activity starts, so an activity's bookings are
// overdue from two weeks before its start day: under way, or pending on a job
// being built with its planned start within `BOOKING_LOOKAHEAD_DAYS`, without
// a confirmed booking for each trade it needs, or with a tradie booked who has
// not confirmed.

const TODAY = new Date(2026, 10, 26, 9);
const yesterday = new Date(2026, 10, 25);
const tomorrow = new Date(2026, 10, 27);
// The last planned start inside the lookahead, and the first outside it.
const lastDueStart = new Date(2026, 10, 26 + BOOKING_LOOKAHEAD_DAYS);
const firstLaterStart = new Date(2026, 10, 27 + BOOKING_LOOKAHEAD_DAYS);

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

  test("the lookahead is two weeks", () => {
    assert.equal(BOOKING_LOOKAHEAD_DAYS, 14);
  });

  test("a pending activity is due from two weeks before its planned start on a job being built", () => {
    const pending = { status: MS.PENDING };
    assert.deepEqual(trades(gaps([], { ...pending, targetDate: yesterday })), [
      "Plumbing",
    ]);
    // The day itself: the booking had to be confirmed before work began.
    assert.deepEqual(
      trades(gaps([], { ...pending, targetDate: new Date(2026, 10, 26) })),
      ["Plumbing"],
    );
    // Upcoming, within two weeks: the booking needs confirming now.
    assert.deepEqual(trades(gaps([], { ...pending, targetDate: tomorrow })), [
      "Plumbing",
    ]);
    assert.deepEqual(
      trades(gaps([], { ...pending, targetDate: lastDueStart })),
      ["Plumbing"],
    );
    assert.deepEqual(gaps([], { ...pending, targetDate: firstLaterStart }), []);
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
        daysToStart: booking.daysToStart,
      })),
      [
        {
          trade: "Carpentry",
          unconfirmed: false,
          started: false,
          daysLate: 3,
          daysToStart: 0,
        },
      ],
    );
    assert.ok(isProjectOverdue(attention));
    assert.equal(overdueLateness(attention), 3);
    const [condition] = attention.conditions;
    assert.equal(condition.kind, "BOOKING_PENDING");
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
    assert.equal(attention.overdueBookings[0]?.daysToStart, 0);
    assert.equal(attention.conditions[0]?.kind, "BOOKING_UNCONFIRMED");
    assert.equal(
      attention.conditions[0]?.label,
      "Carpentry booked, not confirmed for Framing, which starts today",
    );
  });

  test("an upcoming activity within two weeks without a confirmed booking is overdue", () => {
    const attention = assessProjectAttention(
      source({
        milestones: [
          activity({ targetDate: sydneyDay(26 + BOOKING_LOOKAHEAD_DAYS) }),
          activity({ id: "m2", name: "Roofing", targetDate: sydneyDay(30) }),
        ],
      }),
      NOW,
    );
    assert.ok(isProjectOverdue(attention));
    assert.equal(overdueLateness(attention), 0);
    // Soonest start first.
    assert.deepEqual(
      attention.overdueBookings.map((booking) => [
        booking.name,
        booking.daysLate,
        booking.daysToStart,
      ]),
      [
        ["Roofing", 0, 4],
        ["Framing", 0, BOOKING_LOOKAHEAD_DAYS],
      ],
    );
    assert.deepEqual(attention.conditions[0]?.details, [
      "No confirmed Carpentry booking for Roofing, due to start 30 Nov",
      "No confirmed Carpentry booking for Framing, due to start 10 Dec",
    ]);
  });

  test("nobody booked and booked-but-unconfirmed are two conditions", () => {
    const attention = assessProjectAttention(
      source({
        milestones: [
          activity({
            requiredTradeTypes: [{ label: "Carpentry" }, { label: "Plumbing" }],
          }),
          activity({ id: "m2", name: "Roofing", targetDate: sydneyDay(30) }),
        ],
        tradieSchedules: [
          {
            milestoneId: "m1",
            status: "PENDING_RESPONSE",
            trade: "Plumbing",
            tradie: { trade: "Plumbing" },
          },
        ],
      }),
      NOW,
    );
    assert.deepEqual(
      attention.conditions.map((c) => [c.kind, c.count, c.label]),
      [
        ["BOOKING_PENDING", 2, "2 tradie bookings pending: nobody booked"],
        [
          "BOOKING_UNCONFIRMED",
          1,
          "Plumbing booked, not confirmed for Framing, due to start 23 Nov",
        ],
      ],
    );
    assert.deepEqual(attention.conditions[0]?.details, [
      "No confirmed Carpentry booking for Framing, due to start 23 Nov",
      "No confirmed Carpentry booking for Roofing, due to start 30 Nov",
    ]);
  });

  test("a confirmed booking, or a start more than two weeks away, is not overdue", () => {
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
      source({
        milestones: [
          activity({ targetDate: sydneyDay(27 + BOOKING_LOOKAHEAD_DAYS) }),
        ],
      }),
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

  test("the candidate query is a superset: an activity under way, or a pending one starting within the lookahead", () => {
    const where = overdueCandidateWhere(NOW);
    assert.deepEqual(where.OR?.[0], {
      milestones: { some: { status: "ACTIVE" } },
    });
    const pending = where.OR?.[1] as {
      milestones: { some: { targetDate: { lt: Date } } };
    };
    // Exactly the Sydney midnight after the last day that can be due.
    assert.equal(
      pending.milestones.some.targetDate.lt.getTime(),
      sydneyDay(27 + BOOKING_LOOKAHEAD_DAYS).getTime(),
    );
  });

  test("the candidate cutoff is Sydney's calendar boundary across the end of daylight saving", () => {
    // 12:30am AEDT on Thu 25 Mar 2027; daylight saving ends on Sun 4 Apr, so
    // the next fifteen Sydney days are fifteen days and one hour long.
    const justAfterMidnight = new Date("2027-03-24T13:30:00Z");
    // 11:30pm AEST on Thu 8 Apr: the last hour of the last day due.
    const lateOnLastDay = new Date("2027-04-08T13:30:00Z");
    const where = overdueCandidateWhere(justAfterMidnight);
    const pending = where.OR?.[1] as {
      milestones: { some: { targetDate: { lt: Date } } };
    };
    assert.ok(pending.milestones.some.targetDate.lt > lateOnLastDay);
    // The rule agrees that it is due.
    const attention = assessProjectAttention(
      source({ milestones: [activity({ targetDate: lateOnLastDay })] }),
      justAfterMidnight,
    );
    assert.equal(
      attention.overdueBookings[0]?.daysToStart,
      BOOKING_LOOKAHEAD_DAYS,
    );
  });
});
