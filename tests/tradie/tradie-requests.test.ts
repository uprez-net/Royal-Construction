import assert from "node:assert/strict";

import { MilestoneStatus } from "@prisma/client";
import { test } from "vitest";

import {
  deliverTradieRequest,
  draftTradieRequestWorkDetails,
  sendTradieRequests,
  type TradieRequestMailPorts,
  type TradieRequestRenderPort,
} from "@/lib/domain/tradies/requests";
import type { RequestSendFailure } from "@/lib/domain/tradies/request-delivery";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// A request goes outside the office: one email per company, about one trade.
// The expensive mistakes are a tradie asked to price another trade's work, the
// same email several times, and a screen that says "sent" when nobody was
// emailed — so a failed send has to be recorded where the screen can see it.

const PROJECT = {
  id: "p_1",
  location: "11 Wheat Street",
  name: "11 Wheat Street",
  siteManagerId: null,
};

const TRADIES: Record<string, Record<string, unknown>> = {
  t_abc: {
    additionalEmails: ["office@abc.example"],
    archivedAt: null,
    email: "quotes@abc.example",
    id: "t_abc",
    name: "ABC Plumbing Co.",
    trade: "Plumbing",
  },
  t_xyz: {
    additionalEmails: [],
    archivedAt: null,
    email: "estimating@xyz.example",
    id: "t_xyz",
    name: "XYZ Plumbing Services",
    trade: " plumbing ",
  },
  t_spark: {
    additionalEmails: [],
    archivedAt: null,
    email: "quotes@spark.example",
    id: "t_spark",
    name: "Spark & Co.",
    trade: "Electrical",
  },
  t_silent: {
    additionalEmails: [],
    archivedAt: null,
    email: "  ",
    id: "t_silent",
    name: "No Email Plumbing",
    trade: "Plumbing",
  },
};

const MILESTONES = [
  {
    id: "m_rough",
    name: "Rough-in plumbing",
    projectStage: "Frame",
    requiredTradeTypes: [{ label: "Plumbing" }],
    status: MilestoneStatus.PENDING,
  },
  {
    id: "m_fit",
    name: "Plumbing fit-off",
    projectStage: "Interior_Fit_Out",
    requiredTradeTypes: [],
    status: MilestoneStatus.ACTIVE,
  },
  {
    id: "m_done",
    name: "Stormwater",
    projectStage: "Slab",
    requiredTradeTypes: [{ label: "Plumbing" }],
    status: MilestoneStatus.DONE,
  },
  {
    id: "m_elec",
    name: "Switchboard",
    projectStage: "Lockup",
    requiredTradeTypes: [{ label: "Electrical" }],
    status: MilestoneStatus.PENDING,
  },
];

/** A fresh, unclaimed outbox row for whatever key is asked for. */
const OUTBOX = {
  "outboxEvent.findUnique": (args: unknown) => {
    const key = (args as { where: { key: string } }).where.key;
    return {
      attempts: 0,
      id: key,
      key,
      kind: "TRADIE_REQUEST_SEND",
      payload: {},
      status: "PENDING",
    };
  },
  "outboxEvent.updateMany": { count: 1 },
  "outboxEvent.upsert": (args: unknown) => {
    const key = (args as { where: { key: string } }).where.key;
    return { id: key, key, result: null, status: "PENDING" };
  },
};

/** The recipient row a send reads back: as created, before any attempt. */
function recipientRow(id: string) {
  const tradieId = id.replace("r_", "");
  const tradie = TRADIES[tradieId];
  return {
    attempts: 0,
    ccAddresses: tradie.additionalEmails,
    deliveryStatus: "SENDING",
    html: `<p>Dear ${tradie.name as string}</p>`,
    id,
    lastError: null,
    nextAttemptAt: null,
    request: { projectId: "p_1" },
    subject: "Request for Quotation",
    toAddress: (tradie.email as string).trim(),
    tradie: { archivedAt: null, name: tradie.name },
    tradieId,
  };
}

function database(overrides: Parameters<typeof recordingDb>[0] = {}) {
  return recordingDb({
    ...OUTBOX,
    "milestone.findFirst": (args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      return MILESTONES.some((milestone) => milestone.id === id)
        ? { id }
        : null;
    },
    "milestone.findMany": (args: unknown) => {
      const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
      return MILESTONES.filter((milestone) => ids.includes(milestone.id));
    },
    "project.findUnique": PROJECT,
    "tradie.findUnique": (args: unknown) =>
      TRADIES[(args as { where: { id: string } }).where.id] ?? null,
    "tradieRequest.create": { id: "req_1" },
    "tradieRequestRecipient.create": (args: unknown) => {
      const data = (args as { data: { tradieId: string } }).data;
      return { id: `r_${data.tradieId}`, tradieId: data.tradieId };
    },
    "tradieRequestRecipient.findUnique": (args: unknown) =>
      recipientRow((args as { where: { id: string } }).where.id),
    "tradieSchedule.create": (args: unknown) => {
      const data = (args as { data: Record<string, unknown> }).data;
      return { ...data, id: `s_${data.tradieId}_${data.milestoneId}` };
    },
    "tradieSchedule.findFirst": null,
    ...overrides,
  });
}

const ACTIVITIES = [
  {
    durationDays: 2,
    milestoneId: "m_rough",
    scheduledDate: new Date("2026-11-02T00:00:00.000Z"),
  },
  {
    durationDays: 1,
    milestoneId: "m_fit",
    scheduledDate: new Date("2026-12-07T00:00:00.000Z"),
  },
];

const REQUEST = {
  activities: ACTIVITIES,
  projectId: "p_1",
  subject: "Request for Quotation",
  tradieIds: ["t_abc", "t_xyz"],
};

type Rendered = Parameters<TradieRequestRenderPort>[0];

/** Mail ports that send unless an address prefix is told to fail. */
function mail(failures: Partial<Record<string, RequestSendFailure>> = {}) {
  const rendered: Rendered[] = [];
  const sent: Parameters<TradieRequestMailPorts["send"]>[0][] = [];
  const ports: TradieRequestMailPorts & { render: TradieRequestRenderPort } = {
    classifyFailure: (error) => (error as { kind: RequestSendFailure }).kind,
    render: (message) => {
      rendered.push(message);
      return {
        html: `<p>Dear ${message.tradieName}</p>`,
        subject: message.subject,
      };
    },
    send: async (email) => {
      const failure = Object.entries(failures).find(([address]) =>
        email.to.startsWith(address),
      )?.[1];
      if (failure) {
        throw Object.assign(new Error("Graph said no"), { kind: failure });
      }
      sent.push(email);
    },
  };
  return { ports, rendered, sent };
}

type Call = { data: Record<string, unknown>; where: Record<string, unknown> };

function writesTo(
  recorder: { writes(): readonly { operation: string; args: unknown }[] },
  operation: string,
) {
  return recorder
    .writes()
    .filter((call) => call.operation === operation)
    .map((call) => call.args as Call);
}

test("each tradie gets one stored email covering every activity, and a quote booking per activity", async () => {
  const recorder = database();
  const { ports, rendered, sent } = mail();

  const result = await sendTradieRequests(
    adminPrincipal(),
    REQUEST,
    recorder.transactionalDb,
    ports,
  );

  assert.deepEqual(
    rendered.map((message) => message.activities.map((a) => a.name)),
    [
      ["Rough-in plumbing", "Plumbing fit-off"],
      ["Rough-in plumbing", "Plumbing fit-off"],
    ],
  );
  assert.deepEqual(
    sent.map((email) => email.to),
    ["quotes@abc.example", "estimating@xyz.example"],
  );
  assert.deepEqual(sent[0].cc, ["office@abc.example"]);

  const recipients = writesTo(recorder, "tradieRequestRecipient.create");
  assert.equal(recipients.length, 2);
  assert.equal(recipients[0].data.html, "<p>Dear ABC Plumbing Co.</p>");

  const bookings = writesTo(recorder, "tradieSchedule.create");
  assert.equal(bookings.length, 4);
  assert.ok(bookings.every((call) => call.data.status === "AWAITING_QUOTE"));
  assert.deepEqual(
    bookings.map((call) => call.data.requestRecipientId),
    ["r_t_abc", "r_t_abc", "r_t_xyz", "r_t_xyz"],
  );
  assert.deepEqual(
    result.deliveries.map((delivery) => delivery.status),
    ["SENT", "SENT"],
  );
  // Each send went through the outbox under its own attempt key.
  assert.deepEqual(
    writesTo(recorder, "outboxEvent.upsert").map((call) => call.where.key),
    ["tradie-request:r_t_abc:1", "tradie-request:r_t_xyz:1"],
  );
});

test("a clearly-unsent failure is scheduled for an automatic retry; the bookings stay", async () => {
  const recorder = database();
  const { ports, sent } = mail({ estimating: "transient" });

  const result = await sendTradieRequests(
    adminPrincipal(),
    REQUEST,
    recorder.transactionalDb,
    ports,
  );

  assert.equal(sent.length, 1);
  const xyz = result.deliveries.find(
    (delivery) => delivery.tradieId === "t_xyz",
  );
  assert.equal(xyz?.status, "RETRYING");
  assert.ok(xyz?.nextAttemptAt);
  assert.match(xyz?.reason ?? "", /tried again automatically/);
  assert.doesNotMatch(xyz?.reason ?? "", /Graph said no/);
  assert.equal(writesTo(recorder, "tradieSchedule.create").length, 4);
});

test("a refused or ambiguous send fails for a person to decide, never for a robot", async () => {
  for (const [failure, wording] of [
    ["rejected", /refused this email/],
    ["ambiguous", /may have gone out/],
  ] as const) {
    const { ports } = mail({ estimating: failure });
    const result = await sendTradieRequests(
      adminPrincipal(),
      REQUEST,
      database().transactionalDb,
      ports,
    );
    const xyz = result.deliveries.find(
      (delivery) => delivery.tradieId === "t_xyz",
    );
    assert.equal(xyz?.status, "FAILED", failure);
    assert.equal(xyz?.nextAttemptAt, null, failure);
    assert.match(xyz?.reason ?? "", wording);
  }
});

async function assertRefusedWithoutEffects(
  input: Partial<typeof REQUEST>,
  message: RegExp,
  kind: new (...args: never[]) => Error = DomainValidationError,
) {
  const recorder = database();
  const { ports, sent } = mail();
  await assert.rejects(
    sendTradieRequests(
      adminPrincipal(),
      { ...REQUEST, ...input },
      recorder.transactionalDb,
      ports,
    ),
    (error: unknown) =>
      error instanceof kind && message.test((error as Error).message),
  );
  assert.deepEqual(recorder.writes(), []);
  assert.equal(sent.length, 0);
}

test("tradies from different trades are refused before anything is written or sent", async () => {
  await assertRefusedWithoutEffects(
    { tradieIds: ["t_abc", "t_spark"] },
    /Spark & Co\. is listed under Electrical, not Plumbing/,
  );
});

test("an activity the build sequence gives to another trade is refused", async () => {
  await assertRefusedWithoutEffects(
    {
      activities: [{ ...ACTIVITIES[0], milestoneId: "m_elec" }],
      tradieIds: ["t_abc"],
    },
    /Switchboard needs Electrical, not Plumbing/,
  );
});

test("a finished activity cannot be requested", async () => {
  await assertRefusedWithoutEffects(
    {
      activities: [{ ...ACTIVITIES[0], milestoneId: "m_done" }],
      tradieIds: ["t_abc"],
    },
    /Stormwater is already done/,
  );
});

test("an activity on another project is refused", async () => {
  await assertRefusedWithoutEffects(
    {
      activities: [{ ...ACTIVITIES[0], milestoneId: "m_elsewhere" }],
      tradieIds: ["t_abc"],
    },
    /not on this project/,
    DomainNotFoundError,
  );
});

test("a tradie with no email is refused: the request is the email", async () => {
  await assertRefusedWithoutEffects(
    { tradieIds: ["t_abc", "t_silent"] },
    /No Email Plumbing has no email address/,
  );
});

test("the same tradie or activity listed twice is refused", async () => {
  await assertRefusedWithoutEffects(
    { tradieIds: ["t_abc", "t_abc"] },
    /same tradie is listed twice/,
  );
  await assertRefusedWithoutEffects(
    { activities: [ACTIVITIES[0], ACTIVITIES[0]], tradieIds: ["t_abc"] },
    /same activity is listed twice/,
  );
});

test("a tradie already holding the booking refuses the whole request, before any email", async () => {
  const recorder = recordingDb({
    ...OUTBOX,
    "milestone.findFirst": { id: "m_rough" },
    "milestone.findMany": MILESTONES.slice(0, 1),
    "project.findUnique": PROJECT,
    "tradie.findUnique": TRADIES.t_abc,
    "tradieRequest.create": { id: "req_1" },
    "tradieRequestRecipient.create": { id: "r_t_abc", tradieId: "t_abc" },
    "tradieSchedule.findFirst": {
      durationDays: 1,
      scheduledDate: new Date("2026-11-02T00:00:00.000Z"),
    },
  });
  const { ports, sent } = mail();
  await assert.rejects(
    sendTradieRequests(
      adminPrincipal(),
      { ...REQUEST, activities: [ACTIVITIES[0]], tradieIds: ["t_abc"] },
      recorder.transactionalDb,
      ports,
    ),
    /already booked/,
  );
  assert.equal(sent.length, 0);
});

// ---------------------------------------------------------------------------
// Reply references
// ---------------------------------------------------------------------------

test("each tradie's copy carries its own reference, on the subject and to the template; each booking has one too", async () => {
  const recorder = database();
  const { ports, rendered } = mail();

  await sendTradieRequests(
    adminPrincipal(),
    REQUEST,
    recorder.transactionalDb,
    ports,
  );

  const references = rendered.map((message) => message.reference);
  assert.equal(new Set(references).size, 2);
  for (const reference of references) {
    assert.match(reference, /^RCTRQ-[0-9A-F]{12}$/);
  }
  const recipients = writesTo(recorder, "tradieRequestRecipient.create");
  assert.deepEqual(
    recipients.map((call) => call.data.refToken),
    references,
  );
  // The template here ignored the reference; the command added it to what is
  // stored, which is what every send and retry reads back.
  assert.deepEqual(
    recipients.map((call) => call.data.subject),
    references.map((reference) => `Request for Quotation [${reference}]`),
  );
  for (const call of writesTo(recorder, "tradieSchedule.create")) {
    assert.match(String(call.data.refToken), /^RCTBK-[0-9A-F]{12}$/);
  }
});

// ---------------------------------------------------------------------------
// Booking directly
// ---------------------------------------------------------------------------

const BOOKING = { ...REQUEST, kind: "BOOKING" as const, tradieIds: ["t_abc"] };

/** `database()`, plus what a direct booking reads about the trade. */
function bookingDatabase(state: {
  selection?: Record<string, unknown> | null;
  others?: Record<string, unknown>[];
}) {
  return recordingDb({
    ...OUTBOX,
    "milestone.findFirst": (args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      return { id };
    },
    "milestone.findMany": (args: unknown) => {
      const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
      return MILESTONES.filter((milestone) => ids.includes(milestone.id));
    },
    "project.findUnique": PROJECT,
    "tradeSelection.findFirst": state.selection ?? null,
    "tradie.findUnique": (args: unknown) =>
      TRADIES[(args as { where: { id: string } }).where.id] ?? null,
    "tradieRequest.create": { id: "req_1" },
    "tradieRequestRecipient.create": (args: unknown) => {
      const data = (args as { data: { tradieId: string } }).data;
      return { id: `r_${data.tradieId}`, tradieId: data.tradieId };
    },
    "tradieRequestRecipient.findUnique": (args: unknown) =>
      recipientRow((args as { where: { id: string } }).where.id),
    "tradieSchedule.create": (args: unknown) => {
      const data = (args as { data: Record<string, unknown> }).data;
      return { ...data, id: `s_${data.tradieId}_${data.milestoneId}` };
    },
    "tradieSchedule.findFirst": null,
    "tradieSchedule.findMany": state.others ?? [],
  });
}

const XYZ_ROUGH_REQUEST = {
  id: "s_xyz_rough",
  milestone: { name: "Rough-in plumbing" },
  milestoneId: "m_rough",
  quotedPrice: null,
  status: "AWAITING_QUOTE",
  tradie: { name: "XYZ Plumbing Services", trade: " plumbing " },
  tradieId: "t_xyz",
};

test("a direct booking books one tradie without a quote, selects them, and cancels the others' requests", async () => {
  const recorder = bookingDatabase({ others: [XYZ_ROUGH_REQUEST] });
  const { ports, rendered } = mail();

  const result = await sendTradieRequests(
    adminPrincipal(),
    BOOKING,
    recorder.transactionalDb,
    ports,
  );

  assert.equal(result.kind, "BOOKING");
  assert.ok(rendered.every((message) => message.kind === "BOOKING"));
  assert.equal(
    writesTo(recorder, "tradieRequest.create")[0].data.kind,
    "BOOKING",
  );
  const bookings = writesTo(recorder, "tradieSchedule.create");
  assert.equal(bookings.length, 2);
  for (const call of bookings) {
    assert.equal(call.data.status, "PENDING");
    assert.equal(call.data.requiresQuote, false);
  }
  const cancel = writesTo(recorder, "tradieSchedule.updateMany");
  assert.deepEqual(cancel[0].where.id, { in: ["s_xyz_rough"] });
  assert.deepEqual(cancel[0].data, { status: "CANCELLED" });
  assert.deepEqual(result.cancelled, [
    {
      milestoneName: "Rough-in plumbing",
      scheduleId: "s_xyz_rough",
      tradieName: "XYZ Plumbing Services",
    },
  ]);
  assert.deepEqual(writesTo(recorder, "tradeSelection.create")[0].data, {
    projectId: "p_1",
    selectedById: "user_admin",
    trade: "Plumbing",
    tradeKey: "plumbing",
    tradieId: "t_abc",
  });
  // Each tradie's own history says what happened to them, and why.
  const history = writesTo(recorder, "tradieActivityLog.create").map(
    (call) => call.data,
  );
  const cancelled = history.find((row) => row.type === "bookingCancelled");
  assert.equal(cancelled?.tradieId, "t_xyz");
  assert.equal(cancelled?.scheduleId, "s_xyz_rough");
  assert.match(
    String(cancelled?.message),
    /ABC Plumbing Co\. was booked directly for Plumbing/,
  );
  assert.ok(
    history.some(
      (row) => row.type === "selectedForTrade" && row.tradieId === "t_abc",
    ),
  );
});

test("booking a tradie already selected for the trade adds to their bookings without a second selection", async () => {
  const recorder = bookingDatabase({
    selection: {
      status: "ACTIVE",
      tradie: { name: "ABC Plumbing Co." },
      tradieId: "t_abc",
    },
  });
  const { ports } = mail();
  await sendTradieRequests(
    adminPrincipal(),
    BOOKING,
    recorder.transactionalDb,
    ports,
  );
  assert.equal(writesTo(recorder, "tradeSelection.create").length, 0);
  assert.equal(writesTo(recorder, "tradieSchedule.create").length, 2);
});

test("a direct booking is refused before anything is written or sent", async () => {
  const cases: [Parameters<typeof bookingDatabase>[0], RegExp][] = [
    [
      {
        selection: {
          status: "ACTIVE",
          tradie: { name: "XYZ Plumbing Services" },
          tradieId: "t_xyz",
        },
      },
      /XYZ Plumbing Services is already selected for Plumbing/,
    ],
    [
      {
        selection: {
          status: "CANCELLATION_PENDING",
          tradie: { name: "ABC Plumbing Co." },
          tradieId: "t_abc",
        },
      },
      /cancellation for Plumbing is waiting on an admin/,
    ],
    [
      { others: [{ ...XYZ_ROUGH_REQUEST, status: "CONFIRMED" }] },
      /XYZ Plumbing Services is already confirmed for Rough-in plumbing/,
    ],
  ];
  for (const [state, message] of cases) {
    const recorder = bookingDatabase(state);
    const { ports, sent } = mail();
    await assert.rejects(
      sendTradieRequests(
        adminPrincipal(),
        BOOKING,
        recorder.transactionalDb,
        ports,
      ),
      (error: unknown) =>
        error instanceof DomainTransitionError && message.test(error.message),
    );
    assert.deepEqual(recorder.writes(), []);
    assert.equal(sent.length, 0);
  }
});

test("a direct booking names exactly one tradie", async () => {
  await assertRefusedWithoutEffects(
    { kind: "BOOKING", tradieIds: ["t_abc", "t_xyz"] } as Partial<
      typeof REQUEST
    >,
    /Book one tradie at a time/,
  );
});

// ---------------------------------------------------------------------------
// Retrying one email
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-20T01:00:00.000Z");
const SYSTEM = { kind: "system", reason: "test" } as const;

function oneRecipient(
  state: Record<string, unknown>,
  /** The email's bookings still open; 0 once they are all cancelled. */
  openBookings = 1,
) {
  return recordingDb({
    ...OUTBOX,
    "project.findUnique": PROJECT,
    "tradieRequestRecipient.findUnique": {
      ...recipientRow("r_t_abc"),
      ...state,
    },
    "tradieSchedule.count": openBookings,
  });
}

test("an automatic retry that is not yet due, or no longer waiting, does nothing", async () => {
  const { ports, sent } = mail();
  for (const state of [
    {
      attempts: 1,
      deliveryStatus: "RETRYING",
      nextAttemptAt: new Date(NOW.getTime() + 60_000),
    },
    { attempts: 2, deliveryStatus: "SENT", nextAttemptAt: null },
  ]) {
    const recorder = oneRecipient(state);
    await deliverTradieRequest(
      SYSTEM,
      { now: NOW, recipientId: "r_t_abc", trigger: "automatic" },
      recorder.db,
      ports,
    );
    assert.deepEqual(recorder.writes(), []);
  }
  assert.equal(sent.length, 0);
});

test("the last automatic attempt failing hands the email to a person", async () => {
  const recorder = oneRecipient({
    attempts: 3,
    deliveryStatus: "RETRYING",
    nextAttemptAt: new Date(NOW.getTime() - 1000),
  });
  const { ports } = mail({ quotes: "transient" });
  const outcome = await deliverTradieRequest(
    SYSTEM,
    { now: NOW, recipientId: "r_t_abc", trigger: "automatic" },
    recorder.db,
    ports,
  );
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.attempts, 4);
  assert.match(outcome.reason ?? "", /unavailable on all 4 attempts/);
  // The attempt was claimed against the state it was decided from.
  assert.deepEqual(
    writesTo(recorder, "tradieRequestRecipient.updateMany")[0].where,
    { attempts: 3, deliveryStatus: "RETRYING", id: "r_t_abc" },
  );
});

test("a person may retry a failed email, and it is a new attempt", async () => {
  const recorder = oneRecipient({ attempts: 2, deliveryStatus: "FAILED" });
  const { ports, sent } = mail();
  const outcome = await deliverTradieRequest(
    adminPrincipal(),
    { now: NOW, projectId: "p_1", recipientId: "r_t_abc", trigger: "manual" },
    recorder.db,
    ports,
  );
  assert.equal(outcome.status, "SENT");
  assert.equal(sent.length, 1);
  assert.equal(
    writesTo(recorder, "outboxEvent.upsert")[0].where.key,
    "tradie-request:r_t_abc:3",
  );
});

test("a person's retry failing is not followed by an automatic one", async () => {
  const recorder = oneRecipient({ attempts: 1, deliveryStatus: "FAILED" });
  const { ports } = mail({ quotes: "transient" });
  const outcome = await deliverTradieRequest(
    adminPrincipal(),
    { now: NOW, recipientId: "r_t_abc", trigger: "manual" },
    recorder.db,
    ports,
  );
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.nextAttemptAt, null);
});

test("a person cannot retry a sent email, or race a retry that is still on time", async () => {
  for (const [state, wording] of [
    [{ deliveryStatus: "SENT" }, /already been sent/],
    [
      {
        attempts: 1,
        deliveryStatus: "RETRYING",
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
      },
      /already scheduled to be retried/,
    ],
  ] as const) {
    const recorder = oneRecipient(state);
    const { ports, sent } = mail();
    await assert.rejects(
      deliverTradieRequest(
        adminPrincipal(),
        { now: NOW, recipientId: "r_t_abc", trigger: "manual" },
        recorder.db,
        ports,
      ),
      (error: unknown) =>
        error instanceof DomainTransitionError && wording.test(error.message),
    );
    assert.deepEqual(recorder.writes(), []);
    assert.equal(sent.length, 0);
  }
});

test("an email whose bookings were all cancelled is never sent, by the robot or by Retry", async () => {
  // Waiting on an automatic retry when a direct booking took the activities.
  const automatic = oneRecipient(
    {
      attempts: 1,
      deliveryStatus: "RETRYING",
      nextAttemptAt: new Date(NOW.getTime() - 1000),
    },
    0,
  );
  const { ports, sent } = mail();
  const outcome = await deliverTradieRequest(
    SYSTEM,
    { now: NOW, recipientId: "r_t_abc", trigger: "automatic" },
    automatic.db,
    ports,
  );
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.nextAttemptAt, null);
  assert.match(outcome.reason ?? "", /has since been cancelled/);
  // Settled without an attempt or an outbox row.
  assert.deepEqual(
    writesTo(automatic, "tradieRequestRecipient.updateMany")[0].where,
    { attempts: 1, deliveryStatus: "RETRYING", id: "r_t_abc" },
  );
  assert.equal(writesTo(automatic, "outboxEvent.upsert").length, 0);

  const manual = oneRecipient({ attempts: 2, deliveryStatus: "FAILED" }, 0);
  await assert.rejects(
    deliverTradieRequest(
      adminPrincipal(),
      { now: NOW, recipientId: "r_t_abc", trigger: "manual" },
      manual.db,
      ports,
    ),
    (error: unknown) =>
      error instanceof DomainTransitionError
      && /has since been cancelled/.test(error.message),
  );
  assert.deepEqual(manual.writes(), []);
  assert.equal(sent.length, 0);
});

test("a retry that lost the claim to another one does not send", async () => {
  const recorder = recordingDb({
    ...OUTBOX,
    "project.findUnique": PROJECT,
    "tradieRequestRecipient.findUnique": {
      ...recipientRow("r_t_abc"),
      attempts: 2,
      deliveryStatus: "FAILED",
    },
    "tradieRequestRecipient.updateMany": { count: 0 },
    "tradieSchedule.count": 1,
  });
  const { ports, sent } = mail();
  await assert.rejects(
    deliverTradieRequest(
      adminPrincipal(),
      { now: NOW, recipientId: "r_t_abc", trigger: "manual" },
      recorder.db,
      ports,
    ),
    /already being sent/,
  );
  assert.equal(sent.length, 0);
});

// ---------------------------------------------------------------------------
// AI draft
// ---------------------------------------------------------------------------

test("the AI draft is given facts read from the project, not from the screen", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [
      {
        description: "Wet areas only",
        id: "m_rough",
        name: "Rough-in plumbing",
        projectStage: "Frame",
      },
    ],
    "project.findUnique": (args: unknown) =>
      (args as { select: Record<string, boolean> }).select.buildingType
        ? { buildingType: "Double Storey 4BR", description: null }
        : PROJECT,
  });
  let asked: unknown;
  const draft = await draftTradieRequestWorkDetails(
    adminPrincipal(),
    { milestoneIds: ["m_rough"], projectId: "p_1", trade: "Plumbing" },
    recorder.db,
    {
      draftWorkDetails: async (input) => {
        asked = input;
        return { items: [], ok: true };
      },
    },
  );
  assert.deepEqual(draft, { items: [], ok: true });
  assert.deepEqual(asked, {
    activities: [
      {
        description: "Wet areas only",
        milestoneId: "m_rough",
        name: "Rough-in plumbing",
        stage: "Frame",
      },
    ],
    buildingType: "Double Storey 4BR",
    projectDescription: null,
    trade: "Plumbing",
  });
  assert.deepEqual(recorder.writes(), []);
});

test("the AI draft refuses an activity that is not on the project", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [],
    "project.findUnique": (args: unknown) =>
      (args as { select: Record<string, boolean> }).select.buildingType
        ? { buildingType: "Single Storey", description: null }
        : PROJECT,
  });
  await assert.rejects(
    draftTradieRequestWorkDetails(
      adminPrincipal(),
      { milestoneIds: ["m_other"], projectId: "p_1", trade: "Plumbing" },
      recorder.db,
      {
        draftWorkDetails: async () => {
          throw new Error("must not be called");
        },
      },
    ),
    DomainNotFoundError,
  );
});

// ---------------------------------------------------------------------------
// Tradies in several trades
// ---------------------------------------------------------------------------

test("a request is for the trade the office chose, and its bookings say so", async () => {
  const recorder = database();
  const { ports, rendered } = mail();
  await sendTradieRequests(
    adminPrincipal(),
    { ...REQUEST, trade: "plumbing", tradieIds: ["t_abc"] },
    recorder.transactionalDb,
    ports,
  );
  // As the tradie's entry spells it: this is what the email says.
  assert.ok(rendered.every((message) => message.trade === "Plumbing"));
  for (const call of writesTo(recorder, "tradieSchedule.create")) {
    assert.equal(call.data.trade, "Plumbing");
  }
});

test("a tradie not listed under the request's trade is refused, naming the trades they are under", async () => {
  await assertRefusedWithoutEffects(
    { trade: "Gas Fitting", tradieIds: ["t_abc"] } as Partial<typeof REQUEST>,
    /ABC Plumbing Co\. is listed under Plumbing, not Gas Fitting/,
  );
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

type FileRow = {
  fileType: string;
  filename: string;
  filesize: number;
  id: string;
  incidentId: string | null;
  url: string;
};

const FILES: FileRow[] = [
  {
    fileType: "application/pdf",
    filename: "plans.pdf",
    filesize: 2_000_000,
    id: "f_plans",
    incidentId: null,
    url: "https://blob.example/projects/p_1/plans.pdf",
  },
  {
    fileType: "image/jpeg",
    filename: "site.jpg",
    filesize: 500_000,
    id: "f_site",
    incidentId: null,
    url: "https://blob.example/projects/p_1/site.jpg",
  },
];

/** `file.findMany` answering from `files`, scoped to the project asked for. */
function filesOnProject(files: readonly FileRow[]) {
  return (args: unknown) => {
    const where = (
      args as { where: { id: { in: string[] }; projectId: string } }
    ).where;
    return where.projectId === "p_1"
      ? files.filter((file) => where.id.in.includes(file.id))
      : [];
  };
}

test("picked project files are stored with the request and attached to every tradie's copy", async () => {
  const recorder = database({
    "file.findMany": filesOnProject(FILES),
    "tradieRequestRecipient.findUnique": (args: unknown) => ({
      ...recipientRow((args as { where: { id: string } }).where.id),
      request: { attachmentFileIds: ["f_site", "f_plans"], projectId: "p_1" },
    }),
  });
  const { ports, sent } = mail();

  await sendTradieRequests(
    adminPrincipal(),
    { ...REQUEST, attachmentFileIds: ["f_site", "f_plans"] },
    recorder.transactionalDb,
    ports,
  );

  assert.deepEqual(
    writesTo(recorder, "tradieRequest.create")[0].data.attachmentFileIds,
    ["f_site", "f_plans"],
  );
  assert.equal(sent.length, 2);
  for (const email of sent) {
    // In the order the office picked them, not the order the database chose.
    assert.deepEqual(
      email.attachments.map((file) => file.filename),
      ["site.jpg", "plans.pdf"],
    );
  }
});

test("a request with no attachments sends none", async () => {
  const { ports, sent } = mail();
  await sendTradieRequests(
    adminPrincipal(),
    REQUEST,
    database().transactionalDb,
    ports,
  );
  assert.ok(sent.every((email) => email.attachments.length === 0));
});

test("an attachment that is not a file on this project, or is an incident report, is refused before anything is written", async () => {
  for (const [ids, files] of [
    [["f_plans", "f_elsewhere"], FILES],
    [["f_plans"], [{ ...FILES[0], incidentId: "inc_1" }]],
  ] as const) {
    const recorder = database({ "file.findMany": filesOnProject(files) });
    const { ports, sent } = mail();
    await assert.rejects(
      sendTradieRequests(
        adminPrincipal(),
        { ...REQUEST, attachmentFileIds: ids },
        recorder.transactionalDb,
        ports,
      ),
      DomainNotFoundError,
    );
    assert.deepEqual(recorder.writes(), []);
    assert.equal(sent.length, 0);
  }
});

test("attachments over the size an email can carry are refused, saying how big they are", async () => {
  const recorder = database({
    "file.findMany": filesOnProject([
      { ...FILES[0], filesize: 15 * 1024 * 1024 },
      { ...FILES[1], filesize: 6 * 1024 * 1024 },
    ]),
  });
  const { ports } = mail();
  await assert.rejects(
    sendTradieRequests(
      adminPrincipal(),
      { ...REQUEST, attachmentFileIds: ["f_plans", "f_site"] },
      recorder.transactionalDb,
      ports,
    ),
    (error: unknown) =>
      error instanceof DomainValidationError
      && /come to 21 MB; one email can carry 20 MB/.test(error.message),
  );
  assert.deepEqual(recorder.writes(), []);
});

test("the same attachment twice, or too many, is refused", async () => {
  const { ports } = mail();
  for (const ids of [
    ["f_plans", "f_plans"],
    Array.from({ length: 11 }, (_, index) => `f_${index}`),
  ]) {
    await assert.rejects(
      sendTradieRequests(
        adminPrincipal(),
        { ...REQUEST, attachmentFileIds: ids },
        database().transactionalDb,
        ports,
      ),
      DomainValidationError,
    );
  }
});

test("a retry whose attached file was deleted since is not sent a file short, by the robot or by Retry", async () => {
  const withAttachment = (state: Record<string, unknown>) =>
    recordingDb({
      ...OUTBOX,
      "file.findMany": filesOnProject([FILES[1]]),
      "project.findUnique": PROJECT,
      "tradieRequestRecipient.findUnique": {
        ...recipientRow("r_t_abc"),
        request: {
          attachmentFileIds: ["f_plans", "f_site"],
          projectId: "p_1",
        },
        ...state,
      },
      "tradieSchedule.count": 1,
    });
  const { ports, sent } = mail();

  const automatic = withAttachment({
    attempts: 1,
    deliveryStatus: "RETRYING",
    nextAttemptAt: new Date(NOW.getTime() - 1000),
  });
  const outcome = await deliverTradieRequest(
    SYSTEM,
    { now: NOW, recipientId: "r_t_abc", trigger: "automatic" },
    automatic.db,
    ports,
  );
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.nextAttemptAt, null);
  assert.match(outcome.reason ?? "", /deleted from the project/);
  assert.equal(writesTo(automatic, "outboxEvent.upsert").length, 0);

  const manual = withAttachment({ attempts: 2, deliveryStatus: "FAILED" });
  await assert.rejects(
    deliverTradieRequest(
      adminPrincipal(),
      { now: NOW, recipientId: "r_t_abc", trigger: "manual" },
      manual.db,
      ports,
    ),
    (error: unknown) =>
      error instanceof DomainTransitionError
      && /deleted from the project/.test(error.message),
  );
  assert.deepEqual(manual.writes(), []);
  assert.equal(sent.length, 0);
});
