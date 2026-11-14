import assert from "node:assert/strict";
import { test } from "vitest";

import { recordInboundSms } from "@/lib/domain/comms/sms/inbound";
import { isOptOutMessage, smsSegments } from "@/lib/domain/comms/sms/policy";
import { sendLeadSms } from "@/lib/domain/comms/sms/send";
import {
  recordSmsDeliveryStatus,
  smsStatusAdvances,
} from "@/lib/domain/comms/sms/status";
import {
  DomainSideEffectError,
  DomainTransitionError,
} from "@/lib/domain/errors";
import {
  CommsError,
  type CommsChannel,
  type SmsPort,
} from "@/lib/domain/ports/comms";
import { systemPrincipal } from "@/lib/domain/principal";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "../architecture/domain-harness";

// Texting a lead: the rules that decide whether a customer's phone buzzes,
// run against a recording database (file 06 §10, tests 4 and 8).

const channel = (provider: "twilio" | "telnyx" = "twilio"): CommsChannel => ({
  browserCalling: true,
  voiceAgent: false,
  callsAvailable: true,
  defaultNumber: { e164: "+61280001234", label: "Office", provider },
  numbers: [{ e164: "+61280001234", label: "Office", provider }],
  provider,
  recordingMode: "off",
  smsAvailable: true,
  staffForwardNumber: null,
});

const LEAD = {
  assignedId: null,
  id: 7,
  isArchived: false,
  phone: "0412 345 678",
  smsOptedOutAt: null,
};

const MESSAGE_ROW = {
  author: null,
  body: "Hello",
  businessNumber: "+61280001234",
  candidateLeadIds: [],
  customerNumber: "+61412345678",
  deliveredAt: null,
  direction: "OUTBOUND",
  failedAt: null,
  id: "sms-1",
  leadId: 7,
  mediaCount: 0,
  needsReconciliation: false,
  occurredAt: new Date(),
  provider: "TWILIO",
  providerErrorCode: null,
  providerErrorTitle: null,
  providerMessageId: "SM1",
  readAt: null,
  reviewStatus: null,
  status: "QUEUED",
  statusAt: new Date(),
  unmatchedReason: null,
};

function port(
  send: SmsPort["sendSms"],
  provider: "twilio" | "telnyx" = "twilio",
): SmsPort {
  return { provider, sendSms: send };
}

function sendScript(overrides: Record<string, unknown> = {}) {
  return {
    "lead.findUnique": LEAD,
    "outboxEvent.findUnique": { lockedAt: null },
    "outboxEvent.updateMany": { count: 1 },
    "outboxEvent.upsert": {
      id: "ob-1",
      key: "k",
      result: null,
      status: "PENDING",
    },
    "smsMessage.findUnique": (args: { where: Record<string, unknown> }) =>
      "idempotencyKey" in args.where && !("id" in args.where)
        ? null
        : MESSAGE_ROW,
    "smsMessage.upsert": { id: "sms-1" },
    "smsStatusEvent.findMany": [],
    ...overrides,
  };
}

test("a send writes the intent and the message before the carrier hears anything, then records the id", async () => {
  const sent: unknown[] = [];
  const recorder = recordingDb(
    sendScript({
      "outboxEvent.findUnique": {
        attempts: 0,
        id: "ob-1",
        key: "k",
        kind: "LEAD_SMS_SEND",
        payload: {},
        status: "PENDING",
      },
    }),
  );
  const result = await sendLeadSms(
    adminPrincipal(),
    { body: "  Hello  ", idempotencyKey: "key-1", leadId: 7 },
    recorder.transactionalDb,
    {
      channel: channel(),
      sms: port(async (message) => {
        sent.push(message);
        // The intent and the row exist before this runs.
        assert.ok(recorder.operations().includes("outboxEvent.upsert"));
        assert.ok(recorder.operations().includes("smsMessage.upsert"));
        return { providerMessageId: "SM1" };
      }),
    },
  );
  assert.deepEqual(sent, [
    { body: "Hello", from: "+61280001234", to: "+61412345678" },
  ]);
  assert.equal(result.alreadySent, false);
  const update = recorder
    .writes()
    .find((call) => call.operation === "smsMessage.update");
  assert.equal(
    (update?.args as { data: { providerMessageId: string } }).data
      .providerMessageId,
    "SM1",
  );
  assert.ok(recorder.operations().includes("leadHistory.create"));
});

test("a lead who texted STOP is refused before anything is written", async () => {
  const recorder = recordingDb(
    sendScript({ "lead.findUnique": { ...LEAD, smsOptedOutAt: new Date() } }),
  );
  await assert.rejects(
    () =>
      sendLeadSms(
        adminPrincipal(),
        { body: "Hi", idempotencyKey: "k", leadId: 7 },
        recorder.transactionalDb,
        {
          channel: channel(),
          sms: port(async () => assert.fail("must not send")),
        },
      ),
    DomainTransitionError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a portal customer cannot text from Royal's number", async () => {
  const recorder = recordingDb(sendScript());
  await assert.rejects(
    () =>
      sendLeadSms(
        customerPrincipal(),
        { body: "Hi", idempotencyKey: "k", leadId: 7 },
        recorder.transactionalDb,
        {
          channel: channel(),
          sms: port(async () => assert.fail("must not send")),
        },
      ),
    /signed-in member of staff/,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("an ambiguous carrier answer flags the text and is never retried", async () => {
  const recorder = recordingDb(
    sendScript({
      "outboxEvent.findUnique": {
        attempts: 0,
        id: "ob-1",
        key: "k",
        kind: "LEAD_SMS_SEND",
        payload: {},
        status: "PENDING",
      },
    }),
  );
  await assert.rejects(
    () =>
      sendLeadSms(
        adminPrincipal(),
        { body: "Hi", idempotencyKey: "k", leadId: 7 },
        recorder.transactionalDb,
        {
          channel: channel(),
          sms: port(async () => {
            throw new CommsError("timeout", "uncertain", "TWILIO_TIMEOUT");
          }),
        },
      ),
    (error: unknown) =>
      error instanceof DomainSideEffectError && error.retryable === false,
  );
  const fail = recorder
    .writes()
    .find(
      (call) =>
        call.operation === "outboxEvent.updateMany"
        && JSON.stringify(call.args).includes("FAILED"),
    );
  assert.ok(fail, "the intent is closed, not reopened");
  const flagged = recorder
    .writes()
    .find((call) => call.operation === "smsMessage.update");
  assert.equal(
    (flagged?.args as { data: { needsReconciliation?: boolean } }).data
      .needsReconciliation,
    true,
  );
});

test("a definite refusal marks the text failed and reopens the intent for a genuine retry", async () => {
  const recorder = recordingDb(
    sendScript({
      "outboxEvent.findUnique": {
        attempts: 0,
        id: "ob-1",
        key: "k",
        kind: "LEAD_SMS_SEND",
        payload: {},
        status: "PENDING",
      },
    }),
  );
  await assert.rejects(
    () =>
      sendLeadSms(
        adminPrincipal(),
        { body: "Hi", idempotencyKey: "k", leadId: 7 },
        recorder.transactionalDb,
        {
          channel: channel("telnyx"),
          sms: port(async () => {
            throw new CommsError("invalid number", "rejected", "TELNYX_40310");
          }, "telnyx"),
        },
      ),
    (error: unknown) =>
      error instanceof DomainSideEffectError && error.retryable === true,
  );
  const failed = recorder
    .writes()
    .find((call) => call.operation === "smsMessage.update");
  assert.equal(
    (failed?.args as { data: { status: string; providerErrorCode: string } })
      .data.status,
    "FAILED",
  );
  assert.equal(
    (failed?.args as { data: { providerErrorCode: string } }).data
      .providerErrorCode,
    "TELNYX_40310",
  );
});

test("a sender on another carrier is refused rather than handed to the wrong one", async () => {
  const recorder = recordingDb(sendScript());
  await assert.rejects(
    () =>
      sendLeadSms(
        adminPrincipal(),
        { body: "Hi", idempotencyKey: "k", leadId: 7 },
        recorder.transactionalDb,
        {
          channel: channel("twilio"),
          sms: port(async () => assert.fail("must not send"), "telnyx"),
        },
      ),
    /belongs to twilio/,
  );
});

test("STOP is honoured in the same transaction that records it", async () => {
  const recorder = recordingDb({
    "lead.findMany": [{ id: 7 }],
    "lead.findUnique": { smsOptedOutAt: null },
    "smsMessage.create": { id: "in-1" },
    "smsMessage.findUnique": null,
  });
  const outcome = await recordInboundSms(
    systemPrincipal("test"),
    {
      body: " stop ",
      from: "+61412345678",
      mediaCount: 0,
      provider: "telnyx",
      providerMessageId: "msg-1",
      receivedAt: new Date(),
      to: "+61280001234",
    },
    recorder.transactionalDb,
    {
      channel: channel("telnyx"),
    },
  );
  assert.equal(outcome.outcome === "attached" && outcome.optOut, "stopped");
  const optOut = recorder
    .writes()
    .find((call) => call.operation === "lead.update");
  assert.ok(
    (optOut?.args as { data: { smsOptedOutAt: Date } }).data.smsOptedOutAt
      instanceof Date,
  );
});

test("STOP sent to a number we don't recognise still stops every lead with it", async () => {
  const recorder = recordingDb({
    "lead.findMany": [{ id: 7 }, { id: 9 }],
    "lead.updateMany": { count: 2 },
    "smsMessage.create": { id: "in-3" },
    "smsMessage.findUnique": null,
  });
  const outcome = await recordInboundSms(
    systemPrincipal("test"),
    {
      body: "STOP",
      from: "+61412345678",
      mediaCount: 0,
      provider: "twilio",
      providerMessageId: "SM10",
      receivedAt: new Date(),
      to: "+61299990000",
    },
    recorder.transactionalDb,
    { channel: channel() },
  );
  assert.deepEqual(outcome, {
    messageId: "in-3",
    outcome: "unmatched",
    reason: "UNKNOWN_BUSINESS_NUMBER",
  });
  const optOut = recorder
    .writes()
    .find((call) => call.operation === "lead.updateMany");
  assert.deepEqual(
    (optOut?.args as { where: { id: { in: number[] } } }).where.id.in,
    [7, 9],
  );
  const filed = recorder
    .writes()
    .find((call) => call.operation === "smsMessage.create");
  assert.deepEqual(
    (filed?.args as { data: { candidateLeadIds: number[] } }).data
      .candidateLeadIds,
    [],
  );
});

test("a text from a number no lead has waits for a person", async () => {
  const recorder = recordingDb({
    "lead.findMany": [],
    "smsMessage.create": { id: "in-2" },
    "smsMessage.findUnique": null,
  });
  const outcome = await recordInboundSms(
    systemPrincipal("test"),
    {
      body: "Hi",
      from: "+61499999999",
      mediaCount: 0,
      provider: "twilio",
      providerMessageId: "SM9",
      receivedAt: new Date(),
      to: "+61280001234",
    },
    recorder.transactionalDb,
    { channel: channel() },
  );
  assert.deepEqual(outcome, {
    messageId: "in-2",
    outcome: "unmatched",
    reason: "NO_MATCH",
  });
  assert.equal(recorder.operations().includes("leadHistory.create"), false);
});

test("a replayed inbound text is a no-op", async () => {
  const recorder = recordingDb({ "smsMessage.findUnique": { id: "existing" } });
  const outcome = await recordInboundSms(
    systemPrincipal("test"),
    {
      body: "Hi",
      from: "+61412345678",
      mediaCount: 0,
      provider: "twilio",
      providerMessageId: "SM1",
      receivedAt: new Date(),
      to: "+61280001234",
    },
    recorder.transactionalDb,
    { channel: channel() },
  );
  assert.deepEqual(outcome, { outcome: "duplicate" });
  assert.deepEqual(recorder.writes(), []);
});

test("statuses only move forward: a late 'sent' never undoes 'delivered'", async () => {
  assert.equal(smsStatusAdvances("DELIVERED", "SENT"), false);
  assert.equal(smsStatusAdvances("FAILED", "DELIVERED"), false);
  assert.equal(smsStatusAdvances("QUEUED", "DELIVERED"), true);

  const recorder = recordingDb({
    "smsMessage.findUnique": { id: "sms-1", status: "DELIVERED" },
    "smsStatusEvent.create": {},
    "smsStatusEvent.findMany": [
      { errorCode: null, id: "ev", occurredAt: new Date(), status: "SENT" },
    ],
    "smsStatusEvent.findUnique": null,
  });
  const outcome = await recordSmsDeliveryStatus(
    systemPrincipal("test"),
    {
      errorCode: null,
      occurredAt: new Date(),
      provider: "twilio",
      providerMessageId: "SM1",
      status: "SENT",
    },
    recorder.transactionalDb,
  );
  assert.equal(outcome, "stale");
  assert.equal(recorder.operations().includes("smsMessage.update"), false);
});

test("opt-out keywords are whole messages, and segments are counted as carriers bill them", () => {
  assert.equal(isOptOutMessage("STOP"), true);
  assert.equal(isOptOutMessage("Unsubscribe."), true);
  assert.equal(isOptOutMessage("Stop by at 5"), false);
  assert.deepEqual(smsSegments("a".repeat(160)), {
    encoding: "GSM-7",
    segments: 1,
  });
  assert.deepEqual(smsSegments("a".repeat(161)), {
    encoding: "GSM-7",
    segments: 2,
  });
  assert.deepEqual(smsSegments("Thanks 👍"), {
    encoding: "UCS-2",
    segments: 1,
  });
  // An emoji is two UTF-16 units: 69 letters plus one is 71, past one segment.
  assert.deepEqual(smsSegments(`${"a".repeat(69)}👍`), {
    encoding: "UCS-2",
    segments: 2,
  });
});
