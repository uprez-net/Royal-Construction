import assert from "node:assert/strict";

import { MilestoneStatus } from "@prisma/client";
import { test } from "vitest";

import {
  draftTradieRequestWorkDetails,
  sendTradieRequests,
  type TradieRequestEmailPort,
} from "@/lib/domain/tradies/requests";
import {
  DomainNotFoundError,
  DomainValidationError,
} from "@/lib/domain/errors";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// A request goes outside the office: one email per company, about one trade.
// The expensive mistakes are a tradie asked to price another trade's work, the
// same email several times, and a screen that says "sent" when nobody was
// emailed.

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
    requiredTradeType: { label: "Plumbing" },
    status: MilestoneStatus.PENDING,
  },
  {
    id: "m_fit",
    name: "Plumbing fit-off",
    projectStage: "Interior_Fit_Out",
    requiredTradeType: null,
    status: MilestoneStatus.ACTIVE,
  },
  {
    id: "m_done",
    name: "Stormwater",
    projectStage: "Slab",
    requiredTradeType: { label: "Plumbing" },
    status: MilestoneStatus.DONE,
  },
  {
    id: "m_elec",
    name: "Switchboard",
    projectStage: "Lockup",
    requiredTradeType: { label: "Electrical" },
    status: MilestoneStatus.PENDING,
  },
];

function database() {
  return recordingDb({
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
    "tradieSchedule.create": (args: unknown) => {
      const data = (args as { data: Record<string, unknown> }).data;
      return { ...data, id: `s_${data.tradieId}_${data.milestoneId}` };
    },
    "tradieSchedule.findFirst": null,
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

function recordingPort(fail: ReadonlySet<string> = new Set()) {
  const sent: Parameters<TradieRequestEmailPort>[0][] = [];
  const port: TradieRequestEmailPort = async (message) => {
    if (fail.has(message.tradie.id)) throw new Error("Graph said no");
    sent.push(message);
  };
  return { port, sent };
}

test("each tradie gets one email covering every activity, and a quote booking per activity", async () => {
  const recorder = database();
  const { port, sent } = recordingPort();

  const result = await sendTradieRequests(
    adminPrincipal(),
    { activities: ACTIVITIES, projectId: "p_1", tradieIds: ["t_abc", "t_xyz"] },
    recorder.db,
    port,
  );

  assert.deepEqual(
    sent.map((message) => message.tradie.id),
    ["t_abc", "t_xyz"],
  );
  for (const message of sent) {
    assert.deepEqual(
      message.activities.map((activity) => activity.name),
      ["Rough-in plumbing", "Plumbing fit-off"],
    );
    assert.equal(message.trade, "Plumbing");
  }
  assert.deepEqual(sent[0].tradie.additionalEmails, ["office@abc.example"]);

  const creates = recorder
    .writes()
    .map((call) => (call.args as { data: Record<string, unknown> }).data);
  assert.equal(creates.length, 4);
  assert.ok(creates.every((data) => data.requiresQuote === true));
  assert.ok(creates.every((data) => data.status === "AWAITING_QUOTE"));
  assert.deepEqual(
    result.deliveries.map((delivery) => delivery.status),
    ["sent", "sent"],
  );
  assert.equal(result.schedules.length, 4);
});

test("a failed send is reported for that tradie, and the bookings stay saved", async () => {
  const recorder = database();
  const { port, sent } = recordingPort(new Set(["t_xyz"]));

  const result = await sendTradieRequests(
    adminPrincipal(),
    { activities: ACTIVITIES, projectId: "p_1", tradieIds: ["t_abc", "t_xyz"] },
    recorder.db,
    port,
  );

  assert.equal(sent.length, 1);
  const failed = result.deliveries.find(
    (delivery) => delivery.tradieId === "t_xyz",
  );
  assert.equal(failed?.status, "failed");
  assert.ok(failed && failed.status === "failed");
  assert.match(failed.reason, /request is saved/);
  assert.doesNotMatch(failed.reason, /Graph said no/);
  assert.equal(recorder.writes().length, 4);
});

async function assertRefusedWithoutEffects(
  input: Parameters<typeof sendTradieRequests>[1],
  message: RegExp,
  kind: new (...args: never[]) => Error = DomainValidationError,
) {
  const recorder = database();
  const { port, sent } = recordingPort();
  await assert.rejects(
    sendTradieRequests(adminPrincipal(), input, recorder.db, port),
    (error: unknown) =>
      error instanceof kind && message.test((error as Error).message),
  );
  assert.deepEqual(recorder.writes(), []);
  assert.equal(sent.length, 0);
}

test("tradies from different trades are refused before anything is written or sent", async () => {
  await assertRefusedWithoutEffects(
    {
      activities: ACTIVITIES,
      projectId: "p_1",
      tradieIds: ["t_abc", "t_spark"],
    },
    /Spark & Co\. is listed under Electrical, not Plumbing/,
  );
});

test("an activity the build sequence gives to another trade is refused", async () => {
  await assertRefusedWithoutEffects(
    {
      activities: [{ ...ACTIVITIES[0], milestoneId: "m_elec" }],
      projectId: "p_1",
      tradieIds: ["t_abc"],
    },
    /Switchboard needs Electrical, not Plumbing/,
  );
});

test("a finished activity cannot be requested", async () => {
  await assertRefusedWithoutEffects(
    {
      activities: [{ ...ACTIVITIES[0], milestoneId: "m_done" }],
      projectId: "p_1",
      tradieIds: ["t_abc"],
    },
    /Stormwater is already done/,
  );
});

test("an activity on another project is refused", async () => {
  await assertRefusedWithoutEffects(
    {
      activities: [{ ...ACTIVITIES[0], milestoneId: "m_elsewhere" }],
      projectId: "p_1",
      tradieIds: ["t_abc"],
    },
    /not on this project/,
    DomainNotFoundError,
  );
});

test("a tradie with no email is refused: the request is the email", async () => {
  await assertRefusedWithoutEffects(
    {
      activities: ACTIVITIES,
      projectId: "p_1",
      tradieIds: ["t_abc", "t_silent"],
    },
    /No Email Plumbing has no email address/,
  );
});

test("the same tradie or activity listed twice is refused", async () => {
  await assertRefusedWithoutEffects(
    { activities: ACTIVITIES, projectId: "p_1", tradieIds: ["t_abc", "t_abc"] },
    /same tradie is listed twice/,
  );
  await assertRefusedWithoutEffects(
    {
      activities: [ACTIVITIES[0], ACTIVITIES[0]],
      projectId: "p_1",
      tradieIds: ["t_abc"],
    },
    /same activity is listed twice/,
  );
});

test("a tradie already holding the booking refuses the whole request, before any email", async () => {
  const recorder = recordingDb({
    "milestone.findFirst": { id: "m_rough" },
    "milestone.findMany": MILESTONES.slice(0, 1),
    "project.findUnique": PROJECT,
    "tradie.findUnique": TRADIES.t_abc,
    "tradieSchedule.findFirst": {
      durationDays: 1,
      scheduledDate: new Date("2026-11-02T00:00:00.000Z"),
    },
  });
  const { port, sent } = recordingPort();
  await assert.rejects(
    sendTradieRequests(
      adminPrincipal(),
      { activities: [ACTIVITIES[0]], projectId: "p_1", tradieIds: ["t_abc"] },
      recorder.db,
      port,
    ),
    /already booked/,
  );
  assert.equal(sent.length, 0);
});

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
