import assert from "node:assert/strict";
import { test } from "vitest";

import {
  countPendingCommsUnread,
  markPendingCommsRead,
  resolvePendingCall,
} from "@/lib/domain/comms/pending";
import {
  isUnreadCall,
  listLeadCommsUnread,
  markLeadCommsRead,
  UNREAD_CALL_WHERE,
  UNREAD_SMS_WHERE,
} from "@/lib/domain/comms/unread";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { anonymousPrincipal, systemPrincipal } from "@/lib/domain/principal";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "../architecture/domain-harness";

// What counts as unread on a call and a text, what the Pending Calls/Messages
// list holds, and filing a call from it: one rule each, read by the badge and
// the command that clears it alike.

test("a call is unread only when Mili or the voicemail took it and nobody opened it", () => {
  const base = { answeredBy: "AGENT", direction: "INBOUND", seenAt: null };
  assert.equal(isUnreadCall(base as never), true);
  assert.equal(
    isUnreadCall({ ...base, answeredBy: "VOICEMAIL" } as never),
    true,
  );
  // A person was on it, or nobody spoke: nothing to read.
  assert.equal(
    isUnreadCall({ ...base, answeredBy: "BROWSER" } as never),
    false,
  );
  assert.equal(isUnreadCall({ ...base, answeredBy: null } as never), false);
  assert.equal(
    isUnreadCall({ ...base, direction: "OUTBOUND" } as never),
    false,
  );
  assert.equal(isUnreadCall({ ...base, seenAt: new Date() } as never), false);
});

test("the lead list's badge counts unread calls and texts per lead", async () => {
  const seen: Record<string, unknown> = {};
  const harness = recordingDb({
    "call.groupBy": (args: unknown) => {
      seen.call = (args as { where: unknown }).where;
      return [{ _count: { _all: 1 }, leadId: 7 }];
    },
    "smsMessage.groupBy": (args: unknown) => {
      seen.sms = (args as { where: unknown }).where;
      return [
        { _count: { _all: 2 }, leadId: 7 },
        { _count: { _all: 3 }, leadId: 9 },
      ];
    },
  });
  const rows = await listLeadCommsUnread(
    adminPrincipal(),
    { leadIds: [7, 9, 11] },
    harness.db,
  );
  assert.deepEqual(
    rows.sort((a, b) => a.leadId - b.leadId),
    [
      { calls: 1, leadId: 7, sms: 2 },
      { calls: 0, leadId: 9, sms: 3 },
    ],
  );
  assert.deepEqual(seen.call, {
    ...UNREAD_CALL_WHERE,
    lead: { id: { in: [7, 9, 11] } },
  });
  assert.deepEqual(seen.sms, {
    ...UNREAD_SMS_WHERE,
    lead: { id: { in: [7, 9, 11] } },
  });
  assert.deepEqual(harness.writes(), []);
});

test("opening a lead's Phone & SMS window marks its calls and texts read", async () => {
  const harness = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
  });
  const at = new Date("2026-11-16T01:00:00Z");
  await markLeadCommsRead(adminPrincipal(), { at, leadId: 7 }, harness.db);
  assert.deepEqual(
    harness.writes().map((write) => [write.operation, write.args]),
    [
      [
        "smsMessage.updateMany",
        { data: { readAt: at }, where: { ...UNREAD_SMS_WHERE, leadId: 7 } },
      ],
      [
        "call.updateMany",
        { data: { seenAt: at }, where: { ...UNREAD_CALL_WHERE, leadId: 7 } },
      ],
    ],
  );
});

test("the pending list marks read only what it showed, and only pending items", async () => {
  const harness = recordingDb();
  const at = new Date("2026-11-16T01:00:00Z");
  await markPendingCommsRead(
    adminPrincipal(),
    { at, callIds: ["call-1"], smsIds: [] },
    harness.db,
  );
  const writes = harness.writes();
  assert.deepEqual(
    writes.map((write) => write.operation),
    ["call.updateMany"],
    "no text was shown, so no text is touched",
  );
  const where = (writes[0].args as { where: Record<string, unknown> }).where;
  assert.deepEqual(where.id, { in: ["call-1"] });
  assert.equal(where.leadId, null, "a lead's own calls are not cleared here");
  assert.equal(where.dismissedAt, null);
  assert.equal(where.seenAt, null);
});

test("the pending list and its count are for staff only", async () => {
  const harness = recordingDb();
  await assert.rejects(
    countPendingCommsUnread(anonymousPrincipal("test"), harness.db),
    DomainAuthorizationError,
  );
  await assert.rejects(
    markPendingCommsRead(
      anonymousPrincipal("test"),
      { callIds: ["call-1"], smsIds: [] },
      harness.db,
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(harness.calls, []);
});

test("the per-lead counts refuse a non-staff caller and an oversized page", async () => {
  const harness = recordingDb();
  await assert.rejects(
    listLeadCommsUnread(customerPrincipal(), { leadIds: [7] }, harness.db),
    DomainAuthorizationError,
  );
  await assert.rejects(
    listLeadCommsUnread(
      adminPrincipal(),
      { leadIds: Array.from({ length: 201 }, (_, i) => i + 1) },
      harness.db,
    ),
    DomainValidationError,
  );
  assert.deepEqual(harness.calls, []);
});

test("marking read refuses more ids than one window shows", async () => {
  const harness = recordingDb();
  await assert.rejects(
    markPendingCommsRead(
      adminPrincipal(),
      {
        callIds: Array.from({ length: 150 }, (_, i) => `call-${i}`),
        smsIds: Array.from({ length: 51 }, (_, i) => `sms-${i}`),
      },
      harness.db,
    ),
    DomainValidationError,
  );
  assert.deepEqual(harness.writes(), []);
});

test("filing a call onto a lead that isn't there writes nothing", async () => {
  const harness = recordingDb({
    "call.findUnique": pendingCall(),
    "lead.findUnique": null,
  });
  await assert.rejects(
    resolvePendingCall(
      adminPrincipal(),
      { action: "attach", callId: "call-1", leadId: 404 },
      harness.transactionalDb,
    ),
    DomainNotFoundError,
  );
  assert.deepEqual(harness.writes(), []);
});

test("filing a pending call onto a lead moves it there and logs it", async () => {
  const harness = recordingDb({
    "call.findUnique": pendingCall(),
    "call.findUniqueOrThrow": callRow({ leadId: 7 }),
    "lead.findUnique": { assignedId: null, id: 7 },
  });
  const call = await resolvePendingCall(
    adminPrincipal(),
    { action: "attach", callId: "call-1", leadId: 7 },
    harness.transactionalDb,
  );
  assert.equal(call.leadId, 7);
  const [claim, history] = harness.writes();
  assert.equal(claim.operation, "call.updateMany");
  const args = claim.args as {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  };
  assert.equal(args.data.leadId, 7);
  assert.ok(args.data.seenAt instanceof Date);
  assert.deepEqual(args.where, {
    answeredBy: { in: ["AGENT", "VOICEMAIL"] },
    direction: "INBOUND",
    dismissedAt: null,
    id: "call-1",
    leadId: null,
  });
  assert.equal(history.operation, "leadHistory.create");
});

test("dismissing a pending call records who, without touching a lead", async () => {
  const harness = recordingDb({
    "call.findUnique": pendingCall(),
    "call.findUniqueOrThrow": callRow({ dismissedAt: new Date() }),
  });
  await resolvePendingCall(
    adminPrincipal("user_sam"),
    { action: "dismiss", callId: "call-1" },
    harness.transactionalDb,
  );
  assert.deepEqual(
    harness.writes().map((write) => write.operation),
    ["call.updateMany"],
  );
  const data = (harness.writes()[0].args as { data: Record<string, unknown> })
    .data;
  assert.equal(data.dismissedById, "user_sam");
  assert.equal(data.leadId, undefined);
});

test("a call already filed is not filed twice", async () => {
  const harness = recordingDb({
    "call.findUnique": pendingCall({ leadId: 4 }),
  });
  await assert.rejects(
    resolvePendingCall(
      adminPrincipal(),
      { action: "dismiss", callId: "call-1" },
      harness.transactionalDb,
    ),
    DomainTransitionError,
  );
  assert.deepEqual(harness.writes(), []);

  // Two tabs: the second click loses the conditional update.
  const raced = recordingDb({
    "call.findUnique": pendingCall(),
    "call.updateMany": { count: 0 },
  });
  await assert.rejects(
    resolvePendingCall(
      adminPrincipal(),
      { action: "dismiss", callId: "call-1" },
      raced.transactionalDb,
    ),
    DomainTransitionError,
  );
});

test("a call the pending list doesn't show can't be filed or dismissed from it", async () => {
  for (const shape of [
    { direction: "OUTBOUND" },
    { answeredBy: null },
    { answeredBy: "MOBILE" },
  ]) {
    const harness = recordingDb({ "call.findUnique": pendingCall(shape) });
    await assert.rejects(
      resolvePendingCall(
        adminPrincipal(),
        { action: "dismiss", callId: "call-1" },
        harness.transactionalDb,
      ),
      /Only calls on the pending list/,
    );
    assert.deepEqual(harness.writes(), [], JSON.stringify(shape));
  }
});

test("a cron cannot file a call", async () => {
  const harness = recordingDb();
  await assert.rejects(
    resolvePendingCall(
      systemPrincipal("test"),
      { action: "dismiss", callId: "call-1" },
      harness.transactionalDb,
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(harness.calls, []);
});

function pendingCall(overrides: Record<string, unknown> = {}) {
  return {
    answeredBy: "AGENT",
    direction: "INBOUND",
    dismissedAt: null,
    id: "call-1",
    leadId: null,
    ...overrides,
  };
}

function callRow(overrides: Record<string, unknown>) {
  return {
    agentTranscript: "Caller: Hi\nMili: Hello",
    answeredAt: new Date(),
    answeredBy: "AGENT",
    businessNumber: "+61200000000",
    candidateLeadIds: [],
    connectedAt: new Date(),
    customerNumber: "+61412345678",
    direction: "INBOUND",
    dismissedAt: null,
    durationSeconds: 42,
    endedAt: new Date(),
    flowStep: "ENDED",
    hangupCause: null,
    id: "call-1",
    lead: null,
    leadId: null,
    needsReconciliation: false,
    provider: "TELNYX",
    providerErrorTitle: null,
    recordingConsent: "DECLARED",
    recordings: [],
    seenAt: new Date(),
    staffTarget: null,
    staffUser: null,
    startedAt: new Date(),
    status: "COMPLETED",
    ...overrides,
  };
}
