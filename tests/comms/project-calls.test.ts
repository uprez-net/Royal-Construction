import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getProjectCalls,
  listProjectCallContacts,
  PROJECT_CALL_REFUSALS,
  requestProjectCall,
} from "@/lib/domain/comms/calls/project";
import {
  matchCallToProject,
  matchWaitingCallsToProjects,
  PROJECT_MATCH_MAX_ATTEMPTS,
} from "@/lib/domain/comms/calls/project-matching";
import {
  DomainAuthorizationError,
  DomainValidationError,
} from "@/lib/domain/errors";
import type { CommsChannel, VoicePort } from "@/lib/domain/ports/comms";
import type { ProjectCallMatcherPort } from "@/lib/domain/ports/project-call-matcher";
import { systemPrincipal } from "@/lib/domain/principal";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// The project dialer and the inbound call matcher. What matters here: only an
// ADMIN can call or read, the number that rings is the one on the person's
// record (never one the browser sends for them), and the matcher only ever
// files a call onto a project the caller's own number connects them to.

const NOW = new Date("2026-11-23T02:00:00Z");
const BUSINESS = "+61280001234";
const PROJECT = "project-1";

function channel(overrides: Partial<CommsChannel> = {}): CommsChannel {
  return {
    browserCalling: true,
    callsAvailable: true,
    defaultNumber: { e164: BUSINESS, label: "Office", provider: "telnyx" },
    numbers: [{ e164: BUSINESS, label: "Office", provider: "telnyx" }],
    provider: "telnyx",
    recordingMode: "off",
    smsAvailable: true,
    staffForwardNumber: null,
    voiceAgent: false,
    ...overrides,
  };
}

function voice(onPlace?: (to: string) => void): VoicePort {
  return {
    endCall: async () => {},
    lookupCall: async () => ({ found: false }),
    placeCall: async (input) => {
      onPlace?.(input.to);
      return { providerCallId: "v3:call" };
    },
    provider: "telnyx",
  };
}

const TRADIE = {
  archivedAt: null,
  id: "tradie-1",
  name: "Tom Sparks",
  phone: "0412 000 111",
  trade: "Electrician",
};

const PROJECT_ROW = {
  customers: [
    { customer: { id: "cust-1", name: "Olivia Owner", phone: "0412345678" } },
    { customer: { id: "cust-2", name: "Oscar Owner", phone: null } },
  ],
  milestones: [{ tradies: [TRADIE] }],
  siteManager: { id: "sm-1", name: "Sam Site", phone: "0400111222" },
  tradieSchedules: [
    { tradie: TRADIE },
    {
      tradie: {
        archivedAt: new Date(),
        id: "tradie-gone",
        name: "Gone",
        phone: "0400999999",
        trade: "Painter",
      },
    },
  ],
  tradies: [TRADIE],
};

const CALL_ROW = {
  answeredAt: null,
  answeredBy: null,
  businessNumber: BUSINESS,
  candidateLeadIds: [],
  connectedAt: null,
  contactKind: "TRADIE",
  contactName: "Tom Sparks",
  customerNumber: "+61412000111",
  direction: "OUTBOUND",
  durationSeconds: null,
  endedAt: null,
  flowStep: "DIALING_CUSTOMER",
  hangupCause: null,
  id: "call-1",
  lead: null,
  leadId: null,
  needsReconciliation: false,
  project: { id: PROJECT, name: "12 Smith St" },
  projectId: PROJECT,
  projectMatch: null,
  projectMatchReason: null,
  projectSeenAt: NOW,
  provider: "TELNYX",
  providerErrorTitle: null,
  recordingConsent: "NOT_ASKED",
  recordings: [],
  seenAt: null,
  staffPhoneLabel: null,
  staffTarget: "BROWSER",
  staffUser: null,
  startedAt: NOW,
  status: "INITIATED",
};

function placingScript() {
  return {
    "call.findUnique": (args: unknown) =>
      (args as { where: { idempotencyKey?: string } }).where.idempotencyKey
        ? null
        : CALL_ROW,
    "call.upsert": { id: "call-1" },
    "outboxEvent.findUnique": {
      attempts: 0,
      id: "ob",
      key: "k",
      kind: "PROJECT_CALL_PLACE",
      payload: {},
      status: "PENDING",
    },
    "outboxEvent.updateMany": { count: 1 },
    "outboxEvent.upsert": {
      id: "ob",
      key: "k",
      result: null,
      status: "PENDING",
    },
    "project.findUnique": PROJECT_ROW,
  };
}

test("the project's people: site manager, owners in order, live tradies once", async () => {
  const recorder = recordingDb({ "project.findUnique": PROJECT_ROW });
  const contacts = await listProjectCallContacts(PROJECT, recorder.db);
  assert.deepEqual(
    contacts.map((contact) => [contact.kind, contact.name, contact.e164]),
    [
      ["SITE_MANAGER", "Sam Site", "+61400111222"],
      ["OWNER", "Olivia Owner", "+61412345678"],
      ["OWNER", "Oscar Owner", null],
      ["TRADIE", "Tom Sparks", "+61412000111"],
    ],
  );
  assert.equal(contacts[2].problem, "No phone number on file.");
});

test("a site manager can neither read nor place project calls", async () => {
  const recorder = recordingDb(placingScript());
  await assert.rejects(
    getProjectCalls(
      siteManagerPrincipal(),
      { projectId: PROJECT },
      recorder.db,
      {
        channel: channel(),
      },
    ),
    DomainAuthorizationError,
  );
  let rang = false;
  await assert.rejects(
    requestProjectCall(
      siteManagerPrincipal(),
      {
        idempotencyKey: "k",
        projectId: PROJECT,
        target: "browser",
        to: { contactRef: "tradie:tradie-1" },
      },
      recorder.transactionalDb,
      { channel: channel(), voice: voice(() => (rang = true)) },
    ),
    DomainAuthorizationError,
  );
  assert.equal(rang, false);
  assert.deepEqual(recorder.writes(), []);
  assert.deepEqual(recorder.operations(), []);
});

test("calling a person rings the number on their record and files the call on the project", async () => {
  let dialled: string | null = null;
  const recorder = recordingDb(placingScript());
  const result = await requestProjectCall(
    adminPrincipal(),
    {
      idempotencyKey: "k",
      now: NOW,
      projectId: PROJECT,
      target: "browser",
      to: { contactRef: "tradie:tradie-1" },
    },
    recorder.transactionalDb,
    { channel: channel(), voice: voice((to) => (dialled = to)) },
  );
  assert.equal(dialled, "+61412000111");
  assert.equal(result.alreadyPlaced, false);
  const upsert = recorder
    .writes()
    .find((call) => call.operation === "call.upsert");
  const created = (upsert?.args as { create: Record<string, unknown> }).create;
  assert.equal(created.projectId, PROJECT);
  assert.equal(created.contactKind, "TRADIE");
  assert.equal(created.contactName, "Tom Sparks");
  assert.equal(created.contactRef, "tradie:tradie-1");
  assert.equal(created.leadId, undefined);
  assert.equal(created.idempotencyKey, `project-call:${PROJECT}:k`);
  const intent = recorder
    .writes()
    .find((call) => call.operation === "outboxEvent.upsert");
  assert.equal(
    (intent?.args as { create: { kind: string } }).create.kind,
    "PROJECT_CALL_PLACE",
  );
  assert.ok(
    recorder.operations().includes("activityLog.create"),
    "the call is on the project's activity log",
  );
});

test("a retry after a definite refusal re-files the row as whoever this attempt rings", async () => {
  const recorder = recordingDb(placingScript());
  await requestProjectCall(
    adminPrincipal(),
    {
      idempotencyKey: "k",
      now: NOW,
      projectId: PROJECT,
      target: "browser",
      to: { contactRef: "customer:cust-1" },
    },
    recorder.transactionalDb,
    { channel: channel(), voice: voice() },
  );
  const upsert = recorder
    .writes()
    .find((call) => call.operation === "call.upsert");
  const update = (upsert?.args as { update: Record<string, unknown> }).update;
  assert.equal(update.contactName, "Olivia Owner");
  assert.equal(update.contactRef, "customer:cust-1");
  assert.equal(update.customerNumber, "+61412345678");
});

test("a typed number that belongs to someone on the project is filed as them", async () => {
  const recorder = recordingDb(placingScript());
  await requestProjectCall(
    adminPrincipal(),
    {
      idempotencyKey: "k",
      now: NOW,
      projectId: PROJECT,
      target: "browser",
      to: { number: "+61 412 345 678" },
    },
    recorder.transactionalDb,
    { channel: channel(), voice: voice() },
  );
  const upsert = recorder
    .writes()
    .find((call) => call.operation === "call.upsert");
  const created = (upsert?.args as { create: Record<string, unknown> }).create;
  assert.equal(created.contactKind, "OWNER");
  assert.equal(created.contactName, "Olivia Owner");
  assert.equal(created.customerNumber, "+61412345678");
});

test("a typed stranger is filed as another number", async () => {
  const recorder = recordingDb(placingScript());
  await requestProjectCall(
    adminPrincipal(),
    {
      idempotencyKey: "k",
      now: NOW,
      projectId: PROJECT,
      target: "browser",
      to: { number: "02 9999 0000" },
    },
    recorder.transactionalDb,
    { channel: channel(), voice: voice() },
  );
  const upsert = recorder
    .writes()
    .find((call) => call.operation === "call.upsert");
  const created = (upsert?.args as { create: Record<string, unknown> }).create;
  assert.equal(created.contactKind, "OTHER");
  assert.equal(created.contactName, null);
  assert.equal(created.customerNumber, "+61299990000");
});

for (const [label, to, message] of [
  [
    "a number that cannot be rung",
    { number: "123" },
    PROJECT_CALL_REFUSALS.typedInvalid,
  ],
  [
    "Royal's own number",
    { number: "02 8000 1234" },
    PROJECT_CALL_REFUSALS.ownNumber,
  ],
  [
    "somebody no longer on the project",
    { contactRef: "tradie:someone-else" },
    PROJECT_CALL_REFUSALS.notOnProject,
  ],
] as const) {
  test(`${label} is refused, and nothing rings or is written`, async () => {
    let rang = false;
    const recorder = recordingDb(placingScript());
    await assert.rejects(
      requestProjectCall(
        adminPrincipal(),
        {
          idempotencyKey: "k",
          now: NOW,
          projectId: PROJECT,
          target: "browser",
          to,
        },
        recorder.transactionalDb,
        { channel: channel(), voice: voice(() => (rang = true)) },
      ),
      (error: unknown) =>
        error instanceof DomainValidationError && error.message === message,
    );
    assert.equal(rang, false);
    assert.deepEqual(recorder.writes(), []);
  });
}

// ── The matcher ─────────────────────────────────────────────────────────

const SYSTEM = systemPrincipal("test");
const ENDED = new Date(NOW.getTime() - 10 * 60_000);

function inboundCall(overrides: Record<string, unknown> = {}) {
  return {
    agentTranscript:
      "Caller: G'day, it's Tom, about the switchboard at Smith Street.\nMili: Thanks Tom.",
    customerNumber: "+61412000111",
    direction: "INBOUND",
    endedAt: ENDED,
    id: "in-1",
    projectId: null,
    projectMatch: null,
    projectMatchAttempts: 0,
    recordings: [],
    ...overrides,
  };
}

const TRADIE_MATCH = {
  "$.queryRaw": [
    { e164: null, id: "tradie-1", phone: "0412 000 111", source: "tradie" },
  ],
  "tradie.findMany": [{ archivedAt: null, id: "tradie-1", name: "Tom Sparks" }],
};

function candidateProject(id: string, name: string) {
  return {
    customers: [],
    id,
    location: `${name}, Sydney`,
    milestones: [],
    name,
    siteManagerId: null,
    status: "ACTIVE",
    tradieSchedules: [{ tradieId: "tradie-1" }],
    tradies: [{ id: "tradie-1", trade: "Electrician" }],
  };
}

/** `project.findMany` for the two candidate reads: running, then finished. */
function projects(
  live: ReturnType<typeof candidateProject>[],
  finished: ReturnType<typeof candidateProject>[] = [],
) {
  return (args: unknown) => {
    const status = (args as { where: { status: unknown } }).where.status;
    return status === "COMPLETED" ? finished : live;
  };
}

function matchedWrite(recorder: ReturnType<typeof recordingDb>) {
  const write = recorder
    .writes()
    .find((call) => call.operation === "call.updateMany");
  return (write?.args as { data: Record<string, unknown> } | undefined)?.data;
}

test("the model picks one of the caller's projects, and the call is filed there as them", async () => {
  const recorder = recordingDb({
    ...TRADIE_MATCH,
    "call.findUnique": inboundCall(),
    "call.updateMany": { count: 1 },
    "project.findMany": projects([
      candidateProject("p-smith", "12 Smith St"),
      candidateProject("p-jones", "4 Jones Ave"),
    ]),
  });
  let seen: string[] = [];
  const matchProject: ProjectCallMatcherPort = async (input) => {
    seen = input.candidates.map((candidate) => candidate.id);
    return { projectId: "p-smith", reason: "He named Smith Street." };
  };
  const outcome = await matchCallToProject(
    SYSTEM,
    { callId: "in-1", now: NOW },
    recorder.db,
    { matchProject },
  );
  assert.equal(outcome, "matched");
  assert.deepEqual(seen, ["p-smith", "p-jones"]);
  const data = matchedWrite(recorder);
  assert.equal(data?.projectId, "p-smith");
  assert.equal(data?.projectMatch, "MATCHED");
  assert.equal(data?.contactKind, "TRADIE");
  assert.equal(data?.contactName, "Tom Sparks");
});

test("a project the model names that is not the caller's files nothing", async () => {
  const recorder = recordingDb({
    ...TRADIE_MATCH,
    "call.findUnique": inboundCall(),
    "call.updateMany": { count: 1 },
    "project.findMany": projects([candidateProject("p-smith", "12 Smith St")]),
  });
  const outcome = await matchCallToProject(
    SYSTEM,
    { callId: "in-1", now: NOW },
    recorder.db,
    {
      matchProject: async () => ({
        projectId: "someone-elses-project",
        reason: "Because I said so.",
      }),
    },
  );
  assert.equal(outcome, "no_match");
  const data = matchedWrite(recorder);
  assert.equal(data?.projectMatch, "NO_MATCH");
  assert.equal(data?.projectId, undefined);
});

test("a caller on no project is NO_MATCH without asking the model", async () => {
  const recorder = recordingDb({
    "$.queryRaw": [],
    "call.findUnique": inboundCall(),
    "call.updateMany": { count: 1 },
  });
  let asked = false;
  const outcome = await matchCallToProject(
    SYSTEM,
    { callId: "in-1", now: NOW },
    recorder.db,
    {
      matchProject: async () => {
        asked = true;
        return { projectId: null, reason: "" };
      },
    },
  );
  assert.equal(outcome, "no_match");
  assert.equal(asked, false);
  assert.equal(matchedWrite(recorder)?.projectMatch, "NO_MATCH");
});

test("with no transcript, a caller on exactly one project is filed there", async () => {
  const recorder = recordingDb({
    ...TRADIE_MATCH,
    "call.findUnique": inboundCall({ agentTranscript: null }),
    "call.updateMany": { count: 1 },
    "project.findMany": projects([candidateProject("p-smith", "12 Smith St")]),
  });
  const outcome = await matchCallToProject(
    SYSTEM,
    { callId: "in-1", now: NOW },
    recorder.db,
    {
      matchProject: async () => {
        throw new Error("not asked without a transcript");
      },
    },
  );
  assert.equal(outcome, "matched");
  assert.equal(matchedWrite(recorder)?.projectId, "p-smith");
});

test("a voicemail still being transcribed waits, and nothing is written", async () => {
  const recorder = recordingDb({
    "call.findUnique": inboundCall({
      agentTranscript: null,
      recordings: [
        { status: "STORED", transcript: null, transcriptStatus: "PENDING" },
      ],
    }),
  });
  const outcome = await matchCallToProject(
    SYSTEM,
    { callId: "in-1", now: NOW },
    recorder.db,
    { matchProject: async () => ({ projectId: null, reason: "" }) },
  );
  assert.equal(outcome, "waiting");
  assert.deepEqual(recorder.writes(), []);
});

test("a model that keeps failing is retried, then the call is marked FAILED", async () => {
  const failing: ProjectCallMatcherPort = async () => {
    throw new Error("gateway down");
  };
  // The database counts the attempts; the give-up write only lands once the
  // count has reached the limit.
  const script = (reachedLimit: boolean) => ({
    ...TRADIE_MATCH,
    "call.findUnique": inboundCall(),
    "call.updateMany": (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      return {
        count: "projectMatchAttempts" in where && !reachedLimit ? 0 : 1,
      };
    },
    "project.findMany": projects([candidateProject("p-smith", "12 Smith St")]),
  });
  const writes = (recorder: ReturnType<typeof recordingDb>) =>
    recorder
      .writes()
      .map((call) => (call.args as { data: Record<string, unknown> }).data);

  const first = recordingDb(script(false));
  assert.equal(
    await matchCallToProject(SYSTEM, { callId: "in-1", now: NOW }, first.db, {
      matchProject: failing,
    }),
    "retry",
  );
  assert.deepEqual(writes(first)[0], {
    projectMatchAttempts: { increment: 1 },
  });

  const last = recordingDb(script(true));
  assert.equal(
    await matchCallToProject(SYSTEM, { callId: "in-1", now: NOW }, last.db, {
      matchProject: failing,
    }),
    "failed",
  );
  assert.equal(writes(last)[1]?.projectMatch, "FAILED");
  const giveUp = last.writes()[1]?.args as { where: Record<string, unknown> };
  assert.deepEqual(giveUp.where.projectMatchAttempts, {
    gte: PROJECT_MATCH_MAX_ATTEMPTS,
  });
});

test("a call filed by another run while the model failed is left alone", async () => {
  const recorder = recordingDb({
    ...TRADIE_MATCH,
    "call.findUnique": inboundCall(),
    "call.updateMany": { count: 0 },
    "project.findMany": projects([candidateProject("p-smith", "12 Smith St")]),
  });
  assert.equal(
    await matchCallToProject(
      SYSTEM,
      { callId: "in-1", now: NOW },
      recorder.db,
      {
        matchProject: async () => {
          throw new Error("gateway down");
        },
      },
    ),
    "skipped",
  );
  assert.equal(recorder.writes().length, 1, "no give-up write");
});

test("a voicemail whose recording has not arrived yet waits", async () => {
  const recorder = recordingDb({
    "call.findUnique": inboundCall({
      agentTranscript: null,
      answeredBy: "VOICEMAIL",
      recordings: [],
    }),
  });
  const outcome = await matchCallToProject(
    SYSTEM,
    { callId: "in-1", now: NOW },
    recorder.db,
    { matchProject: async () => ({ projectId: null, reason: "" }) },
  );
  assert.equal(outcome, "waiting");
  assert.deepEqual(recorder.writes(), []);
});

test("running builds are candidates before finished ones", async () => {
  const done = {
    ...candidateProject("p-old", "1 Old Rd"),
    status: "COMPLETED",
  };
  const recorder = recordingDb({
    ...TRADIE_MATCH,
    "call.findUnique": inboundCall(),
    "call.updateMany": { count: 1 },
    "project.findMany": projects(
      [candidateProject("p-smith", "12 Smith St")],
      [done],
    ),
  });
  let seen: string[] = [];
  await matchCallToProject(SYSTEM, { callId: "in-1", now: NOW }, recorder.db, {
    matchProject: async (input) => {
      seen = input.candidates.map((candidate) => candidate.id);
      return { projectId: null, reason: "" };
    },
  });
  assert.deepEqual(seen, ["p-smith", "p-old"]);
  const reads = recorder.calls.filter(
    (call) => call.operation === "project.findMany",
  );
  assert.deepEqual(
    (reads[0].args as { where: { status: unknown } }).where.status,
    { not: "COMPLETED" },
  );
});

test("one call the database fails on does not stop the run", async () => {
  const recorder = recordingDb({
    "call.findMany": [{ id: "bad" }, { id: "good" }],
    "call.findUnique": (args: unknown) => {
      if ((args as { where: { id: string } }).where.id === "bad")
        throw new Error("connection reset");
      return inboundCall({ customerNumber: "withheld", id: "good" });
    },
    "call.updateMany": { count: 1 },
  });
  const totals = await matchWaitingCallsToProjects(
    SYSTEM,
    recorder.db,
    {
      matchProject: async () => ({ projectId: null, reason: "" }),
    },
    { now: NOW },
  );
  assert.equal(totals.error, 1);
  assert.equal(totals.no_match, 1);
});

test("a site manager cannot run the matcher", async () => {
  const recorder = recordingDb({});
  await assert.rejects(
    matchCallToProject(
      siteManagerPrincipal(),
      { callId: "in-1", now: NOW },
      recorder.db,
      { matchProject: async () => ({ projectId: null, reason: "" }) },
    ),
    DomainAuthorizationError,
  );
});
