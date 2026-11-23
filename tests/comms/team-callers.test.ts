import assert from "node:assert/strict";
import { test } from "vitest";

import { listAdminInboundCalls } from "@/lib/domain/comms/calls/queries";
import {
  countPendingCommsUnread,
  listPendingComms,
} from "@/lib/domain/comms/pending";
import { listTeamCallers } from "@/lib/domain/comms/team-callers";
import { DomainAuthorizationError } from "@/lib/domain/errors";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// A team member ringing the business number is not a prospect: their call
// never waits on the leads page's Pending Calls/Messages, and the admin page
// lists it under their name instead of with the unknown numbers.

const OFFICE_MOBILE = "+61400000000";

const TEAM = {
  "commsTeamPhone.findMany": [
    { e164: "+61411111111", nickname: "Raj" },
    // Also Sam's own number: the person's name wins.
    { e164: "+61422222222", nickname: "Sam's work phone" },
  ],
  "user.findMany": [
    { name: "Sam Site", phone: "0422 222 222", role: "SITE_MANAGER" },
    { name: "Office", phone: "+61 2 8000 9999", role: "ADMIN" },
    { name: "No Phone", phone: "", role: "ADMIN" },
  ],
};

const TEAM_NUMBERS = [
  "+61422222222",
  "+61280009999",
  "+61411111111",
  OFFICE_MOBILE,
];

function callRow(id: string, customerNumber: string) {
  return {
    agentTranscript: null,
    answeredAt: null,
    answeredBy: "AGENT",
    businessNumber: "+61280001234",
    candidateLeadIds: [],
    connectedAt: null,
    contactKind: null,
    contactName: null,
    customerNumber,
    direction: "INBOUND",
    durationSeconds: 40,
    endedAt: null,
    flowStep: "ENDED",
    hangupCause: null,
    id,
    lead: null,
    leadId: null,
    needsReconciliation: false,
    project: null,
    projectId: null,
    projectMatch: null,
    projectMatchReason: null,
    projectSeenAt: null,
    provider: "TELNYX",
    providerErrorTitle: null,
    recordingConsent: "DECLARED",
    recordings: [],
    seenAt: null,
    staffPhoneLabel: null,
    staffTarget: null,
    staffUser: null,
    startedAt: new Date("2026-11-23T01:00:00Z"),
    status: "COMPLETED",
  };
}

test("the team: staff by the number on their account, then team phones, then the office mobile, each number once", async () => {
  const recorder = recordingDb(TEAM);
  const callers = await listTeamCallers(recorder.db, {
    channel: { staffForwardNumber: OFFICE_MOBILE },
  });
  assert.deepEqual(
    callers.map((caller) => [caller.e164, caller.name, caller.kind]),
    [
      ["+61422222222", "Sam Site", "staff"],
      ["+61280009999", "Office", "staff"],
      ["+61411111111", "Raj", "team_phone"],
      [OFFICE_MOBILE, "Office mobile", "office_mobile"],
    ],
  );
});

test("the pending list, and its badge, leave out calls from the team", async () => {
  const recorder = recordingDb({
    ...TEAM,
    "call.count": 0,
    "call.findMany": [],
    "smsMessage.count": 0,
    "smsMessage.findMany": [],
  });
  await listPendingComms(adminPrincipal(), recorder.db, {
    channel: { staffForwardNumber: OFFICE_MOBILE },
  });
  await countPendingCommsUnread(adminPrincipal(), recorder.db, {
    channel: { staffForwardNumber: OFFICE_MOBILE },
  });
  const callQueries = recorder.calls.filter(
    (call) =>
      call.operation === "call.findMany" || call.operation === "call.count",
  );
  assert.equal(callQueries.length, 3);
  for (const query of callQueries) {
    const where = (query.args as { where: Record<string, unknown> }).where;
    assert.deepEqual(where.customerNumber, { notIn: TEAM_NUMBERS });
  }
});

test("the admin page lists team calls under the team member's name, apart from unknown numbers", async () => {
  const recorder = recordingDb({
    ...TEAM,
    "call.findMany": (args: unknown) => {
      const where = (args as { where: { customerNumber: object } }).where;
      return "in" in where.customerNumber
        ? [callRow("team-1", "+61422222222"), callRow("team-2", OFFICE_MOBILE)]
        : [callRow("unknown-1", "+61499999999")];
    },
  });
  const result = await listAdminInboundCalls(adminPrincipal(), recorder.db, {
    channel: { staffForwardNumber: OFFICE_MOBILE },
  });
  assert.deepEqual(
    result.unknown.map((call) => call.id),
    ["unknown-1"],
  );
  assert.deepEqual(
    result.team.map(({ call, caller }) => [call.id, caller.name]),
    [
      ["team-1", "Sam Site"],
      ["team-2", "Office mobile"],
    ],
  );
});

test("a site manager cannot read the admin page's calls", async () => {
  const recorder = recordingDb(TEAM);
  await assert.rejects(
    listAdminInboundCalls(siteManagerPrincipal(), recorder.db),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.operations(), []);
});
