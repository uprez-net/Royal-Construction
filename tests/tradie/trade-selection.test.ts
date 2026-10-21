import assert from "node:assert/strict";

import { MilestoneStatus } from "@prisma/client";
import { test } from "vitest";

import { classifyGraphSendFailure } from "@/lib/graph/retry";
import { requestEmailAttentionItems } from "@/lib/domain/tradies/attention";
import {
  canRetryRequestEmail,
  deliveryAfterFailure,
  isStalledSend,
  MAX_AUTOMATIC_ATTEMPTS,
  type RequestDeliveryState,
} from "@/lib/domain/tradies/request-delivery";
import { resolveTradieApproval } from "@/lib/domain/tradies/approvals";
import {
  bookingsDisplacedBySelection,
  selectionRefusal,
  type SelectionBooking,
} from "@/lib/domain/tradies/selection-rules";
import {
  recordManualQuote,
  requestTradeCancellation,
  selectTradeQuote,
  settleTradeCancellation,
} from "@/lib/domain/tradies/trade-selection";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// Choosing one tradie for a trade sends their bookings to approval and
// cancels everyone else's on the same activities; releasing them goes through
// an admin. And a request email that did not go is retried only when it
// clearly was not sent.

const NOW = new Date("2026-10-20T01:00:00.000Z");

// ---------------------------------------------------------------------------
// When an email is retried
// ---------------------------------------------------------------------------

test("only a clearly-unsent failure is retried automatically, on the schedule", () => {
  const first = deliveryAfterFailure("transient", 1, "initial", NOW);
  assert.equal(first.deliveryStatus, "RETRYING");
  assert.equal(first.nextAttemptAt?.getTime(), NOW.getTime() + 5 * 60_000);
  assert.equal(
    deliveryAfterFailure(
      "transient",
      2,
      "automatic",
      NOW,
    ).nextAttemptAt?.getTime(),
    NOW.getTime() + 30 * 60_000,
  );
  assert.equal(
    deliveryAfterFailure("transient", MAX_AUTOMATIC_ATTEMPTS, "automatic", NOW)
      .deliveryStatus,
    "FAILED",
  );
  assert.equal(
    deliveryAfterFailure("ambiguous", 1, "initial", NOW).deliveryStatus,
    "FAILED",
  );
  assert.equal(
    deliveryAfterFailure("rejected", 1, "initial", NOW).deliveryStatus,
    "FAILED",
  );
  assert.equal(
    deliveryAfterFailure("transient", 1, "manual", NOW).deliveryStatus,
    "FAILED",
  );
});

const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

/** A delivery stored an hour ago, attempted when `lastAttemptAt` says. */
const delivery = (
  state: Pick<RequestDeliveryState, "attempts" | "deliveryStatus">
    & Partial<RequestDeliveryState>,
): RequestDeliveryState => ({
  createdAt: minutesAgo(60),
  lastAttemptAt: state.attempts > 0 ? minutesAgo(60) : null,
  nextAttemptAt: null,
  ...state,
});

test("a person may retry once it failed, or once a scheduled retry is overdue", () => {
  assert.equal(
    canRetryRequestEmail(
      delivery({ attempts: 2, deliveryStatus: "FAILED" }),
      NOW,
    ),
    true,
  );
  assert.equal(
    canRetryRequestEmail(
      delivery({ attempts: 1, deliveryStatus: "SENT" }),
      NOW,
    ),
    false,
  );
  const due = (minutes: number) =>
    canRetryRequestEmail(
      delivery({
        attempts: 1,
        deliveryStatus: "RETRYING",
        nextAttemptAt: minutesAgo(minutes),
      }),
      NOW,
    );
  assert.equal(
    due(5),
    false,
    "a retry a few minutes late is still the robot's",
  );
  assert.equal(due(11), true, "a retry well overdue is a person's");
});

test("a send that never reported back becomes a person's call, after a grace period", () => {
  const sending = (attempts: number, lastAttemptAt: Date | null) =>
    delivery({
      attempts,
      createdAt: minutesAgo(60),
      deliveryStatus: "SENDING",
      lastAttemptAt,
    });
  // In flight: the robot or the request that claimed it is still going.
  assert.equal(isStalledSend(sending(1, minutesAgo(2)), NOW), false);
  assert.equal(canRetryRequestEmail(sending(1, minutesAgo(2)), NOW), false);
  // Claimed long ago and never finished.
  assert.equal(isStalledSend(sending(1, minutesAgo(11)), NOW), true);
  assert.equal(canRetryRequestEmail(sending(1, minutesAgo(11)), NOW), true);
  // Stored and never attempted at all: timed from when it was stored.
  assert.equal(isStalledSend(sending(0, null), NOW), true);
  assert.equal(
    isStalledSend(
      delivery({
        attempts: 0,
        createdAt: minutesAgo(1),
        deliveryStatus: "SENDING",
      }),
      NOW,
    ),
    false,
  );
});

test("Graph failures are sorted by whether the email might have gone", () => {
  const graph = (status: number) => Object.assign(new Error("x"), { status });
  assert.equal(classifyGraphSendFailure(graph(429)), "transient");
  assert.equal(classifyGraphSendFailure(graph(503)), "transient");
  assert.equal(classifyGraphSendFailure(graph(400)), "rejected");
  assert.equal(classifyGraphSendFailure(graph(403)), "rejected");
  assert.equal(classifyGraphSendFailure(graph(408)), "ambiguous");
  assert.equal(classifyGraphSendFailure(graph(500)), "ambiguous");
  assert.equal(classifyGraphSendFailure(graph(504)), "ambiguous");
  const fetchFailed = (code: string) =>
    Object.assign(new TypeError("fetch failed"), { cause: { code } });
  assert.equal(
    classifyGraphSendFailure(fetchFailed("ECONNREFUSED")),
    "transient",
  );
  assert.equal(
    classifyGraphSendFailure(fetchFailed("ECONNRESET")),
    "ambiguous",
  );
  assert.equal(classifyGraphSendFailure(new Error("timeout")), "ambiguous");
});

test("one alert per failed email, on its soonest open booking, never for a sent one", () => {
  const failed = {
    ...delivery({ attempts: 2, deliveryStatus: "FAILED" }),
    id: "r_1",
  };
  const items = requestEmailAttentionItems(
    [
      {
        id: "s_2",
        requestRecipient: failed,
        scheduledDate: "2026-11-09",
        status: "AWAITING_QUOTE" as const,
      },
      {
        id: "s_1",
        requestRecipient: failed,
        scheduledDate: "2026-11-02",
        status: "AWAITING_QUOTE" as const,
      },
      {
        id: "s_3",
        requestRecipient: {
          ...failed,
          deliveryStatus: "SENT" as const,
          id: "r_2",
        },
        scheduledDate: "2026-11-02",
        status: "AWAITING_QUOTE" as const,
      },
      // A cancelled booking no longer needs its email.
      {
        id: "s_4",
        requestRecipient: { ...failed, id: "r_3" },
        scheduledDate: "2026-11-02",
        status: "CANCELLED" as const,
      },
      // A send stuck at "sending" is raised too: nothing else will finish it.
      {
        id: "s_5",
        requestRecipient: {
          ...delivery({ attempts: 1, deliveryStatus: "SENDING" }),
          id: "r_4",
        },
        scheduledDate: "2026-11-05",
        status: "AWAITING_QUOTE" as const,
      },
    ],
    NOW,
  );
  assert.deepEqual(
    items.map((item) => [item.booking.id, item.attention.action]),
    [
      ["s_1", "retry-email"],
      ["s_5", "retry-email"],
    ],
  );
});

// ---------------------------------------------------------------------------
// Who may be selected
// ---------------------------------------------------------------------------

const booking = (overrides: Partial<SelectionBooking>): SelectionBooking => ({
  milestoneId: "m_rough",
  milestoneName: "Rough-in",
  quotedPrice: "450.00",
  status: "QUOTE_RECEIVED",
  trade: "Plumbing",
  tradieName: "ABC",
  ...overrides,
});

test("a tradie can be selected once every open activity of theirs has a quote", () => {
  const base = {
    liveSelection: null,
    others: [] as SelectionBooking[],
    trade: "Plumbing",
    tradieName: "ABC",
  };
  assert.equal(selectionRefusal({ ...base, own: [booking({})] }), null);
  assert.match(
    selectionRefusal({
      ...base,
      own: [
        booking({}),
        booking({
          milestoneName: "Fit-off",
          quotedPrice: null,
          status: "AWAITING_QUOTE",
        }),
      ],
    })?.message ?? "",
    /Record ABC's quote for Fit-off first/,
  );
  assert.match(
    selectionRefusal({ ...base, own: [booking({ status: "CANCELLED" })] })
      ?.message ?? "",
    /no open Plumbing booking/,
  );
  assert.match(
    selectionRefusal({
      ...base,
      liveSelection: { status: "ACTIVE", tradieName: "XYZ" },
      own: [booking({})],
    })?.message ?? "",
    /XYZ is already selected for Plumbing/,
  );
  assert.match(
    selectionRefusal({
      ...base,
      others: [booking({ status: "CONFIRMED", tradieName: "XYZ" })],
      own: [booking({})],
    })?.message ?? "",
    /XYZ is already confirmed for Rough-in/,
  );
});

test("a selection displaces only open bookings of the same trade on the same activities", () => {
  const own = [booking({})];
  const others = [
    {
      ...booking({ tradieName: "XYZ" }),
      id: "keep-other-activity",
      milestoneId: "m_fit",
    },
    { ...booking({ tradieName: "XYZ" }), id: "cancel" },
    {
      ...booking({ status: "DECLINED", tradieName: "PQR" }),
      id: "already-out",
    },
    {
      ...booking({ trade: "Electrical", tradieName: "Sparky" }),
      id: "other-trade",
    },
  ];
  assert.deepEqual(
    bookingsDisplacedBySelection(own, others, "plumbing").map((b) => b.id),
    ["cancel"],
  );
});

const PROJECT = {
  id: "p_1",
  location: "x",
  name: "11 Wheat Street",
  siteManagerId: null,
};
const ABC = {
  archivedAt: null,
  email: "a@x",
  id: "t_abc",
  name: "ABC",
  trade: "Plumbing",
};

test("selection is refused while someone holds the trade, and nothing is written", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": { status: "ACTIVE", tradie: { name: "XYZ" } },
    "tradie.findUnique": ABC,
    "tradieSchedule.findMany": [],
  });
  await assert.rejects(
    selectTradeQuote(
      adminPrincipal(),
      { projectId: "p_1", tradieId: "t_abc" },
      recorder.db,
    ),
    (error: unknown) =>
      error instanceof DomainTransitionError
      && /XYZ is already selected/.test(error.message),
  );
  assert.deepEqual(recorder.writes(), []);
});

test("selecting cancels the rivals' bookings on the same activities and records the selection", async () => {
  const bookings = [
    {
      id: "s_xyz",
      milestone: { name: "Rough-in" },
      milestoneId: "m_rough",
      quotedPrice: "500.00",
      status: "QUOTE_RECEIVED",
      tradie: { name: "XYZ", trade: "Plumbing" },
      tradieId: "t_xyz",
    },
    // Already approved through the old per-booking path: kept as it is.
    {
      id: "s_abc",
      milestone: { name: "Rough-in" },
      milestoneId: "m_rough",
      quotedPrice: "450.00",
      status: "AWAITING_ADMIN_APPROVAL",
      tradie: { name: "ABC", trade: "Plumbing" },
      tradieId: "t_abc",
    },
  ];
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "tradeSelection.create": { id: "sel_1" },
    "tradeSelection.findFirst": null,
    "tradie.findUnique": ABC,
    "tradieSchedule.findMany": bookings,
  });
  const result = await selectTradeQuote(
    adminPrincipal(),
    { projectId: "p_1", tradieId: "t_abc" },
    recorder.db,
  );
  assert.deepEqual(
    result.cancelled.map((c) => c.scheduleId),
    ["s_xyz"],
  );
  const cancel = recorder
    .writes()
    .find((w) => w.operation === "tradieSchedule.updateMany");
  assert.deepEqual(
    (cancel?.args as { where: { id: { in: string[] } } }).where.id.in,
    ["s_xyz"],
  );
  const created = recorder
    .writes()
    .find((w) => w.operation === "tradeSelection.create");
  assert.deepEqual((created?.args as { data: Record<string, unknown> }).data, {
    projectId: "p_1",
    selectedById: "user_admin",
    trade: "Plumbing",
    tradeKey: "plumbing",
    tradieId: "t_abc",
  });
});

// ---------------------------------------------------------------------------
// Manual quotes
// ---------------------------------------------------------------------------

const MILESTONE = {
  estimatedDays: 3,
  id: "m_rough",
  name: "Rough-in",
  requiredTradeTypes: [{ label: "Plumbing" }],
  startDate: null,
  status: MilestoneStatus.PENDING,
  targetDate: new Date("2026-11-10T00:00:00.000Z"),
};

const QUOTE = {
  gstTreatment: "INCLUSIVE" as const,
  lines: [{ amount: 450, milestoneId: "m_rough" }],
  projectId: "p_1",
  quotedAt: new Date("2026-10-19T00:00:00.000Z"),
  tradieId: "t_abc",
};

test("a manual quote only prices the tradie's booking in the trade quoted for", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [MILESTONE],
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": null,
    "tradie.findUnique": ABC,
    "tradieQuote.create": { id: "q_1" },
    "tradieSchedule.findFirst": { id: "s_abc", status: "AWAITING_QUOTE" },
  });
  await recordManualQuote(adminPrincipal(), QUOTE, recorder.db);
  const lookup = recorder.calls.find(
    (call) => call.operation === "tradieSchedule.findFirst",
  );
  assert.deepEqual((lookup?.args as { where: { OR: unknown } }).where.OR, [
    { trade: { equals: "Plumbing", mode: "insensitive" } },
    {
      trade: null,
      tradie: { trade: { equals: "Plumbing", mode: "insensitive" } },
    },
  ]);
});

test("a manual quote is written onto the tradie's booking for the activity", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [MILESTONE],
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": null,
    "tradie.findUnique": ABC,
    "tradieQuote.create": { id: "q_1" },
    "tradieSchedule.findFirst": { id: "s_abc", status: "AWAITING_QUOTE" },
  });
  const result = await recordManualQuote(adminPrincipal(), QUOTE, recorder.db);
  assert.deepEqual(result.bookings, [{ created: false, scheduleId: "s_abc" }]);
  const quote = recorder
    .writes()
    .find((w) => w.operation === "tradieQuote.create");
  assert.equal(
    (quote?.args as { data: { source: string } }).data.source,
    "MANUAL",
  );
  const priced = recorder
    .writes()
    .find((w) => w.operation === "tradieSchedule.updateMany");
  assert.deepEqual((priced?.args as { data: Record<string, unknown> }).data, {
    quoteId: "q_1",
    quotedPrice: "450.00",
    requiresQuote: true,
    status: "QUOTE_RECEIVED",
  });
});

test("an approved booking's price cannot be changed by a manual quote", async () => {
  for (const booking of [
    // Asked to quote, quoted, approved.
    { quotedPrice: "450.00", requestRecipient: null, requiresQuote: true },
    // Booked directly, priced, approved.
    {
      quotedPrice: "450.00",
      requestRecipient: { request: { kind: "BOOKING" } },
      requiresQuote: true,
    },
  ]) {
    const recorder = recordingDb({
      "milestone.findMany": [MILESTONE],
      "project.findUnique": PROJECT,
      "tradeSelection.findFirst": null,
      "tradie.findUnique": ABC,
      "tradieQuote.create": { id: "q_1" },
      "tradieSchedule.findFirst": {
        id: "s_abc",
        status: "CONFIRMED",
        ...booking,
      },
    });
    await assert.rejects(
      recordManualQuote(adminPrincipal(), QUOTE, recorder.db),
      /booking for Rough-in is confirmed/,
    );
  }
});

test("a directly booked tradie's price lands on the booking without moving it", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [MILESTONE],
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": null,
    "tradie.findUnique": ABC,
    "tradieQuote.create": { id: "q_1" },
    "tradieSchedule.findFirst": {
      id: "s_abc",
      quotedPrice: null,
      requestRecipient: { request: { kind: "BOOKING" } },
      requiresQuote: false,
      status: "PENDING_RESPONSE",
    },
  });
  await recordManualQuote(adminPrincipal(), QUOTE, recorder.db);
  const priced = recorder
    .writes()
    .find((w) => w.operation === "tradieSchedule.updateMany");
  // No status: "quote received" would put it back into a comparison. And no
  // requiresQuote: it stays a direct booking, so its price stays editable.
  assert.deepEqual(priced?.args, {
    data: { quoteId: "q_1", quotedPrice: "450.00" },
    where: { id: "s_abc", quotedPrice: null, status: "PENDING_RESPONSE" },
  });
});

test("an approved direct booking with no price yet can have it filled in, and its waiting approval shows it", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [MILESTONE],
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": null,
    "tradie.findUnique": ABC,
    "tradieApproval.findFirst": {
      id: "ap_1",
      updationData: { cost: "$0", scheduleId: "s_abc" },
    },
    "tradieQuote.create": { id: "q_1" },
    "tradieSchedule.findFirst": {
      id: "s_abc",
      quotedPrice: null,
      requestRecipient: { request: { kind: "BOOKING" } },
      requiresQuote: false,
      status: "AWAITING_ADMIN_APPROVAL",
    },
  });
  await recordManualQuote(adminPrincipal(), QUOTE, recorder.db);
  const priced = recorder
    .writes()
    .find((w) => w.operation === "tradieSchedule.updateMany");
  assert.equal(
    (priced?.args as { data: Record<string, unknown> }).data.status,
    undefined,
  );
  const approval = recorder
    .writes()
    .find((w) => w.operation === "tradieApproval.update");
  assert.deepEqual(approval?.args, {
    data: { updationData: { cost: "$450", scheduleId: "s_abc" } },
    where: { id: "ap_1" },
  });
});

test("a quote booking that stopped waiting on its quote stays closed to a manual quote", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [MILESTONE],
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": null,
    "tradie.findUnique": ABC,
    "tradieQuote.create": { id: "q_1" },
    "tradieSchedule.findFirst": {
      id: "s_abc",
      quotedPrice: null,
      requestRecipient: { request: { kind: "QUOTE" } },
      requiresQuote: true,
      status: "NO_RESPONSE",
    },
  });
  await assert.rejects(
    recordManualQuote(adminPrincipal(), QUOTE, recorder.db),
    /booking for Rough-in is unanswered/,
  );
});

test("a manual quote with no amount, or a zero one, is refused before anything is written", async () => {
  for (const lines of [[], [{ amount: 0, milestoneId: "m_rough" }]]) {
    const recorder = recordingDb({});
    await assert.rejects(
      recordManualQuote(adminPrincipal(), { ...QUOTE, lines }, recorder.db),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  }
});

// ---------------------------------------------------------------------------
// Cancelling a selected tradie
// ---------------------------------------------------------------------------

test("a cancellation request needs a reason, and only marks the selection pending", async () => {
  const selection = {
    id: "sel_1",
    projectId: "p_1",
    status: "ACTIVE",
    trade: "Plumbing",
    tradie: { id: "t_abc", name: "ABC" },
  };
  await assert.rejects(
    requestTradeCancellation(
      adminPrincipal(),
      { reason: "  ", selectionId: "sel_1" },
      recordingDb({}).db,
    ),
    DomainValidationError,
  );
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "tradeSelection.findUnique": selection,
    "tradieApproval.create": { id: "ap_1" },
    "tradieSchedule.count": 2,
  });
  const result = await requestTradeCancellation(
    adminPrincipal(),
    { reason: "Cannot meet the dates", selectionId: "sel_1" },
    recorder.db,
  );
  assert.equal(result.approvalId, "ap_1");
  // The request is on the tradie's history; no booking moves until an admin
  // approves.
  assert.deepEqual(
    recorder.writes().map((w) => w.operation),
    [
      "tradieApproval.create",
      "tradeSelection.updateMany",
      "tradieActivityLog.create",
    ],
    "no booking moves until an admin approves",
  );
});

test("a cancellation for a selection on another project is not found, before anything is written", async () => {
  const recorder = recordingDb({
    "tradeSelection.findUnique": {
      id: "sel_1",
      projectId: "p_other",
      status: "ACTIVE",
      trade: "Plumbing",
      tradie: { id: "t_abc", name: "ABC" },
    },
  });
  await assert.rejects(
    requestTradeCancellation(
      adminPrincipal(),
      {
        projectId: "p_1",
        reason: "Cannot meet the dates",
        selectionId: "sel_1",
      },
      recorder.db,
    ),
    DomainNotFoundError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a manual quote from a rival of the selected tradie is refused, and no quote is created", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [MILESTONE],
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": { tradie: { name: "XYZ Plumbing" } },
    "tradie.findUnique": ABC,
  });
  await assert.rejects(
    recordManualQuote(adminPrincipal(), QUOTE, recorder.db),
    (error: unknown) =>
      error instanceof DomainTransitionError
      && /XYZ Plumbing is already selected/.test(error.message),
  );
  assert.deepEqual(recorder.writes(), []);
});

test("approving a cancellation ends the selection and cancels the tradie's open bookings", async () => {
  const recorder = recordingDb({
    "tradeSelection.updateMany": { count: 1 },
    "tradieSchedule.findMany": [{ id: "s_1" }, { id: "s_2" }],
  });
  const affected = await settleTradeCancellation(
    {
      id: "ap_1",
      payload: {
        projectId: "p_1",
        projectName: "11 Wheat Street",
        selectionId: "sel_1",
        trade: "Plumbing",
      },
      tradieId: "t_abc",
    },
    true,
    recorder.db,
    NOW,
  );
  assert.equal(affected.cancelledSchedules, 2);
  const cancel = recorder
    .writes()
    .find((w) => w.operation === "tradieSchedule.updateMany");
  assert.deepEqual((cancel?.args as { data: unknown }).data, {
    status: "CANCELLED",
  });
});

test("rejecting a cancellation puts the selection back and touches no booking", async () => {
  const recorder = recordingDb({});
  await settleTradeCancellation(
    {
      id: "ap_1",
      payload: { projectId: "p_1", selectionId: "sel_1" },
      tradieId: "t_abc",
    },
    false,
    recorder.db,
  );
  assert.deepEqual(recorder.operations(), ["tradeSelection.updateMany"]);
});

test("removing a tradie ends their selections, including one waiting on a cancellation", async () => {
  const recorder = recordingDb({
    "tradie.updateMany": { count: 1 },
    "tradieApproval.findUnique": {
      actionType: "TRADIE_REMOVAL",
      id: "ap_remove",
      tradie: { id: "t_abc", name: "ABC", trade: "Plumbing" },
      tradieId: "t_abc",
      updationData: {},
    },
    "tradieApproval.updateMany": { count: 1 },
    "tradieSchedule.findMany": [{ projectId: "p_1" }],
    "tradieSchedule.updateMany": { count: 1 },
    "tradeSelection.updateMany": { count: 1 },
  });
  const resolved = await resolveTradieApproval(
    adminPrincipal(),
    { approvalId: "ap_remove", resolution: "approved" },
    recorder.db,
  );

  const pending = recorder
    .writes()
    .filter((w) => w.operation === "tradieApproval.updateMany")
    .map((w) => (w.args as { where: Record<string, unknown> }).where)
    .find((where) => where.tradieId === "t_abc" && where.status === "PENDING");
  assert.ok(
    pending,
    "the pending trade cancellation is rejected with the rest",
  );

  const ended = recorder
    .writes()
    .find((w) => w.operation === "tradeSelection.updateMany");
  const args = ended?.args as {
    data: { status: string };
    where: { tradieId: string; status: { in: string[] } };
  };
  assert.equal(args.data.status, "CANCELLED");
  assert.equal(args.where.tradieId, "t_abc");
  assert.deepEqual(
    [...args.where.status.in].sort(),
    ["ACTIVE", "CANCELLATION_PENDING"],
    "a selection waiting on the rejected cancellation is ended, not left pending",
  );
  assert.equal(resolved.affected.endedSelections, 1);
});

test("a manual quote's new booking never starts before today in Sydney", async () => {
  // 08:00 in Sydney on 21 Oct is still 20 Oct in UTC.
  const morning = new Date("2026-10-20T21:00:00.000Z");
  const recorder = recordingDb({
    "milestone.findMany": [
      { ...MILESTONE, targetDate: new Date("2026-10-20T00:00:00.000Z") },
    ],
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": null,
    "tradie.findUnique": ABC,
    "tradieQuote.create": { id: "q_1" },
    "tradieSchedule.create": (args: unknown) => ({
      ...(args as { data: Record<string, unknown> }).data,
      id: "s_new",
    }),
    "tradieSchedule.findFirst": null,
    "milestone.findFirst": { id: "m_rough" },
  });
  await recordManualQuote(
    adminPrincipal(),
    { ...QUOTE, today: morning },
    recorder.db,
  );
  const created = recorder
    .writes()
    .find((w) => w.operation === "tradieSchedule.create");
  assert.equal(
    (created?.args as { data: { scheduledDate: Date } }).data.scheduledDate
      .toISOString()
      .slice(0, 10),
    "2026-10-21",
  );
});
