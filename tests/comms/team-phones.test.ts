import assert from "node:assert/strict";
import { test } from "vitest";

import { requestLeadCall } from "@/lib/domain/comms/calls/outbound";
import { evaluateLeadCallOptions } from "@/lib/domain/comms/calls/queries";
import {
  callablePhones,
  createTeamPhone,
  deleteTeamPhone,
  OFFICE_MOBILE_LABEL,
} from "@/lib/domain/comms/team-phones";
import { DomainValidationError } from "@/lib/domain/errors";
import type { CommsChannel, VoicePort } from "@/lib/domain/ports/comms";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// "Call via phone" rang one env number, so only whoever carried the office
// mobile could take a lead call away from a browser. An admin now keeps the
// team's phones, and the caller picks which one rings.

const NOW = new Date("2026-11-16T00:00:00Z");
const BUSINESS = "+61280001234";

function channel(overrides: Partial<CommsChannel> = {}): CommsChannel {
  return {
    browserCalling: true,
    callsAvailable: true,
    defaultNumber: { e164: BUSINESS, label: "Office", provider: "twilio" },
    numbers: [{ e164: BUSINESS, label: "Office", provider: "twilio" }],
    provider: "twilio",
    recordingMode: "off",
    smsAvailable: true,
    staffForwardNumber: null,
    voiceAgent: false,
    ...overrides,
  };
}

const voice: VoicePort = {
  endCall: async () => {},
  lookupCall: async () => ({ found: false }),
  placeCall: async () => ({ providerCallId: "CA1" }),
  provider: "twilio",
};

const RAJ = {
  createdAt: NOW,
  e164: "+61411111111",
  id: "phone-raj",
  nickname: "Raj",
  updatedAt: NOW,
};

function placingScript(extra: Record<string, unknown> = {}) {
  return {
    "call.findUnique": (args: unknown) =>
      (args as { where: { idempotencyKey?: string } }).where.idempotencyKey
        ? null
        : {
            answeredAt: null,
            answeredBy: null,
            businessNumber: BUSINESS,
            candidateLeadIds: [],
            connectedAt: null,
            customerNumber: "+61412345678",
            direction: "OUTBOUND",
            durationSeconds: null,
            endedAt: null,
            flowStep: "DIALING_CUSTOMER",
            hangupCause: null,
            id: "call-1",
            lead: { id: 7, name: "Sam" },
            leadId: 7,
            needsReconciliation: false,
            provider: "TWILIO",
            providerErrorTitle: null,
            recordingConsent: "NOT_ASKED",
            recordings: [],
            seenAt: null,
            staffPhoneLabel: "Raj",
            staffTarget: "MOBILE",
            staffUser: null,
            startedAt: NOW,
            status: "INITIATED",
          },
    "call.upsert": { id: "call-1" },
    "lead.findUnique": {
      assignedId: null,
      id: 7,
      isArchived: false,
      phone: "0412345678",
    },
    "outboxEvent.findUnique": {
      attempts: 0,
      id: "ob",
      key: "k",
      kind: "LEAD_CALL_PLACE",
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
    ...extra,
  };
}

test("a call via a team phone stores that phone's number and nickname on the call", async () => {
  const recorder = recordingDb(
    placingScript({ "commsTeamPhone.findUnique": RAJ }),
  );
  await requestLeadCall(
    adminPrincipal(),
    {
      idempotencyKey: "k",
      leadId: 7,
      now: NOW,
      phoneId: "phone-raj",
      target: "mobile",
    },
    recorder.transactionalDb,
    { channel: channel(), voice },
  );
  const upsert = recorder
    .writes()
    .find((call) => call.operation === "call.upsert");
  const created = (
    upsert?.args as {
      create: { staffPhoneNumber: string; staffPhoneLabel: string };
    }
  ).create;
  assert.equal(created.staffPhoneNumber, "+61411111111");
  assert.equal(created.staffPhoneLabel, "Raj");
});

test("a phone removed since the picker loaded is refused, and nothing rings", async () => {
  let rang = false;
  const recorder = recordingDb(
    placingScript({ "commsTeamPhone.findUnique": null }),
  );
  await assert.rejects(
    requestLeadCall(
      adminPrincipal(),
      {
        idempotencyKey: "k",
        leadId: 7,
        now: NOW,
        phoneId: "phone-gone",
        target: "mobile",
      },
      recorder.transactionalDb,
      {
        channel: channel({ staffForwardNumber: "+61400000000" }),
        voice: {
          ...voice,
          placeCall: async () => {
            rang = true;
            return { providerCallId: "CA1" };
          },
        },
      },
    ),
    (error) =>
      error instanceof DomainValidationError
      && /taken off the team list/.test(error.message),
  );
  assert.equal(rang, false, "never falls back to a different phone");
  assert.deepEqual(recorder.writes(), []);
});

test("no phone at all: calling via a phone is refused before anything is written", async () => {
  const recorder = recordingDb(placingScript());
  await assert.rejects(
    requestLeadCall(
      adminPrincipal(),
      { idempotencyKey: "k", leadId: 7, now: NOW, target: "mobile" },
      recorder.transactionalDb,
      { channel: channel(), voice },
    ),
    /No phone is set up/,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("the picker lists the team's phones, then the office mobile unless a team phone has its number", () => {
  const team = [{ e164: RAJ.e164, id: RAJ.id, nickname: RAJ.nickname }];
  assert.deepEqual(
    callablePhones(team, { staffForwardNumber: "+61400000000" }).map(
      (phone) => [phone.id, phone.nickname],
    ),
    [
      ["phone-raj", "Raj"],
      [null, OFFICE_MOBILE_LABEL],
    ],
  );
  assert.equal(
    callablePhones(team, { staffForwardNumber: RAJ.e164 }).length,
    1,
    "the same number is not offered twice",
  );

  const options = evaluateLeadCallOptions(
    { isArchived: false, phone: "0412345678" },
    channel({ browserCalling: false }),
    team,
  );
  assert.equal(options.allowed, true, "a team phone alone is enough to call");
  assert.equal(options.mobile, true);
  assert.equal(options.phones.length, 1);
});

test("adding a team phone: admin only, a real number, never a business number", async () => {
  const recorder = recordingDb({ "commsTeamPhone.findFirst": null });
  await assert.rejects(
    createTeamPhone(
      siteManagerPrincipal(),
      { nickname: "Raj", number: "0411 111 111" },
      recorder.db,
      { channel: channel() },
    ),
    /restricted to administrators/,
  );
  await assert.rejects(
    createTeamPhone(
      adminPrincipal(),
      { nickname: "Raj", number: "12345" },
      recorder.db,
      { channel: channel() },
    ),
    /isn't a valid phone number/,
  );
  await assert.rejects(
    createTeamPhone(
      adminPrincipal(),
      { nickname: "Front desk", number: "02 8000 1234" },
      recorder.db,
      { channel: channel() },
    ),
    /one of the business numbers/,
  );
  await assert.rejects(
    createTeamPhone(
      adminPrincipal(),
      { nickname: "   ", number: "0411 111 111" },
      recorder.db,
      { channel: channel() },
    ),
    /nickname/,
  );
  assert.deepEqual(recorder.writes(), []);

  await createTeamPhone(
    adminPrincipal(),
    { nickname: "  Raj   S ", number: "0411 111 111" },
    recorder.db,
    { channel: channel() },
  );
  const [create] = recorder.writes();
  assert.equal(create.operation, "commsTeamPhone.create");
  assert.deepEqual((create.args as { data: unknown }).data, {
    e164: "+61411111111",
    nickname: "Raj S",
  });
});

test("adding a number already on the list names who has it", async () => {
  const recorder = recordingDb({
    "commsTeamPhone.findFirst": { nickname: "Raj" },
  });
  await assert.rejects(
    createTeamPhone(
      adminPrincipal(),
      { nickname: "Raj again", number: "+61 411 111 111" },
      recorder.db,
      { channel: channel() },
    ),
    /already on the list as "Raj"/,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("removing a phone that is already gone says so", async () => {
  const recorder = recordingDb({ "commsTeamPhone.deleteMany": { count: 0 } });
  await assert.rejects(
    deleteTeamPhone(adminPrincipal(), { id: "phone-gone" }, recorder.db),
    /no longer listed/,
  );
});
