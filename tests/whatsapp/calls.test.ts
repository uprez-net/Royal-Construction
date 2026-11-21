import assert from "node:assert/strict";
import { test } from "vitest";

import { evaluateWhatsAppCallPermission } from "@/lib/domain/leads/whatsapp/call-permissions";
import {
  answerWhatsAppCall,
  recordWhatsAppCallEvent,
} from "@/lib/domain/leads/whatsapp/calls";
import { DomainTransitionError } from "@/lib/domain/errors";
import type {
  WhatsAppCallsPort,
  WhatsAppChannel,
  WhatsAppPort,
} from "@/lib/domain/ports/whatsapp";
import { systemPrincipal } from "@/lib/domain/principal";
import { parseWhatsAppWebhook } from "@/lib/whatsapp/webhook-payload";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// WhatsApp calling through Meta's Cloud API, answered in a browser: the
// webhook shapes, who may answer, and when a customer may be called.

const NUMBER_ID = "109876543210987";
const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n";

function delivery(field: string, value: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            field,
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: NUMBER_ID },
              ...value,
            },
          },
        ],
        id: "100000000000000",
      },
    ],
    object: "whatsapp_business_account",
  };
}

test("a customer's call arrives as a connect event carrying Meta's SDP offer", () => {
  const parsed = parseWhatsAppWebhook(
    delivery("calls", {
      calls: [
        {
          direction: "USER_INITIATED",
          event: "connect",
          from: "61412345678",
          id: "wacid.1",
          session: { sdp: SDP, sdp_type: "offer" },
          timestamp: "1762300800",
          to: "61280001234",
        },
      ],
    }),
  );
  assert.deepEqual(parsed?.callEvents, [
    {
      at: new Date(1762300800 * 1000),
      bizOpaqueCallbackData: null,
      businessPhoneNumberId: NUMBER_ID,
      customerWaId: "61412345678",
      kind: "connect",
      providerCallId: "wacid.1",
      sdp: SDP,
      sdpType: "offer",
    },
  ]);
});

test("terminate and call statuses parse; a call status is never a message status", () => {
  const parsed = parseWhatsAppWebhook(
    delivery("calls", {
      calls: [
        {
          duration: 93,
          event: "terminate",
          id: "wacid.1",
          status: ["COMPLETED"],
          timestamp: "1762300900",
        },
      ],
      statuses: [
        {
          biz_opaque_callback_data: "royal-1",
          id: "wacid.2",
          status: "REJECTED",
          timestamp: "1762300901",
          type: "call",
        },
      ],
    }),
  );
  assert.equal(parsed?.callEvents.length, 2);
  assert.equal(
    parsed?.callEvents[0].kind === "terminate"
      && parsed.callEvents[0].durationSeconds,
    93,
  );
  assert.deepEqual(
    parsed?.callEvents[1].kind === "status"
      && parsed.callEvents[1].bizOpaqueCallbackData,
    "royal-1",
  );

  const onMessages = parseWhatsAppWebhook(
    delivery("messages", {
      statuses: [
        {
          id: "wacid.3",
          status: "ACCEPTED",
          timestamp: "1762300902",
          type: "call",
        },
      ],
    }),
  );
  assert.equal(onMessages?.statuses.length, 0);
  assert.equal(onMessages?.callEvents.length, 1);
});

test("only the customer's tap on Allow is a grant — never a typed message", () => {
  const parsed = parseWhatsAppWebhook(
    delivery("messages", {
      messages: [
        {
          from: "61412345678",
          id: "wamid.p",
          interactive: {
            call_permission_reply: {
              expiration_timestamp: 1762905600,
              is_permanent: false,
              response: "accept",
            },
            type: "call_permission_reply",
          },
          timestamp: "1762300800",
          type: "interactive",
        },
        {
          from: "61412345678",
          id: "wamid.t",
          text: { body: "yes you can call me" },
          timestamp: "1762300801",
          type: "text",
        },
      ],
    }),
  );
  assert.equal(parsed?.callPermissionReplies.length, 1);
  assert.equal(parsed?.callPermissionReplies[0].accepted, true);
  assert.deepEqual(
    parsed?.callPermissionReplies[0].expiresAt,
    new Date(1762905600 * 1000),
  );
  assert.deepEqual(
    parsed?.messages.map((message) => message.providerMessageId),
    ["wamid.t"],
    "the text stays an ordinary message",
  );
});

test("a ringing call is recorded once, matched to its lead", async () => {
  const recorder = recordingDb({
    "lead.findMany": [{ id: 7 }],
    "whatsAppCall.create": {},
    "whatsAppCall.findUnique": null,
  });
  const outcome = await recordWhatsAppCallEvent(
    systemPrincipal("test"),
    {
      at: new Date(),
      bizOpaqueCallbackData: null,
      businessPhoneNumberId: NUMBER_ID,
      customerWaId: "61412345678",
      kind: "connect",
      providerCallId: "wacid.1",
      sdp: SDP,
      sdpType: "offer",
    },
    recorder.transactionalDb,
    { channel: null },
  );
  assert.equal(outcome, "ringing");
  const created = recorder
    .writes()
    .find((call) => call.operation === "whatsAppCall.create");
  assert.equal(
    (created?.args as { data: { leadId: number; customerPhoneE164: string } })
      .data.leadId,
    7,
  );
  assert.equal(
    (created?.args as { data: { customerPhoneE164: string } }).data
      .customerPhoneE164,
    "+61412345678",
  );
});

function callsPort(overrides: Partial<WhatsAppCallsPort> = {}): WhatsAppPort {
  const calls: WhatsAppCallsPort = {
    accept: async () => {},
    connect: async () => ({ providerCallId: "x" }),
    preAccept: async () => {},
    reject: async () => {},
    sendPermissionRequest: async () => ({ providerMessageId: "m" }),
    terminate: async () => {},
    ...overrides,
  };
  return {
    calls,
    channel: { callingEnabled: true } as WhatsAppChannel,
    sendTemplate: async () => ({ providerMessageId: "" }),
    sendText: async () => ({ providerMessageId: "" }),
  };
}

test("two browsers answering: the second is told someone already has it, and Meta hears once", async () => {
  let accepted = 0;
  const recorder = recordingDb({
    "whatsAppCall.findUnique": {
      businessPhoneNumberId: NUMBER_ID,
      direction: "INBOUND",
      id: "c1",
      providerCallId: "wacid.1",
      startedAt: new Date(),
      status: "RINGING",
    },
    "whatsAppCall.updateMany": { count: 0 },
  });
  await assert.rejects(
    () =>
      answerWhatsAppCall(
        adminPrincipal(),
        { callId: "c1", sdpAnswer: SDP },
        recorder.transactionalDb,
        {
          whatsapp: callsPort({ accept: async () => void (accepted += 1) }),
        },
      ),
    (error: unknown) =>
      error instanceof DomainTransitionError
      && /already answered/.test(error.message),
  );
  assert.equal(accepted, 0);
});

test("answering pre-accepts then accepts with the browser's SDP", async () => {
  const actions: string[] = [];
  const recorder = recordingDb({
    "whatsAppCall.findUnique": (args: { select: Record<string, unknown> }) =>
      "remoteSdp" in args.select
        ? {
            answeredAt: new Date(),
            businessDisplayNumber: "+61280001234",
            customerPhoneE164: "+61412345678",
            direction: "INBOUND",
            durationSeconds: null,
            endedAt: null,
            failureReason: null,
            id: "c1",
            lead: null,
            needsReconciliation: false,
            remoteSdp: null,
            staffUser: null,
            startedAt: new Date(),
            status: "ACCEPTED",
          }
        : {
            businessPhoneNumberId: NUMBER_ID,
            direction: "INBOUND",
            id: "c1",
            providerCallId: "wacid.1",
            startedAt: new Date(),
            status: "RINGING",
          },
    "whatsAppCall.updateMany": { count: 1 },
  });
  const call = await answerWhatsAppCall(
    adminPrincipal(),
    { callId: "c1", sdpAnswer: SDP },
    recorder.transactionalDb,
    {
      whatsapp: callsPort({
        accept: async (target) =>
          void actions.push(`accept:${target.sdpAnswer === SDP.trim()}`),
        preAccept: async () => void actions.push("pre_accept"),
      }),
    },
  );
  assert.deepEqual(actions, ["pre_accept", "accept:true"]);
  assert.equal(call.status, "ACCEPTED");
});

test("calling needs a grant; asking needs an open window and respects Meta's rate limits", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const channel: WhatsAppChannel = {
    callingEnabled: true,
    defaultPhoneNumberId: NUMBER_ID,
    enabledTemplateNames: null,
    numbers: [
      {
        displayNumber: "+61280001234",
        label: "Office",
        phoneNumberId: NUMBER_ID,
      },
    ],
    sendingAvailable: true,
  };
  const lead = {
    isArchived: false,
    phone: "0412345678",
    whatsappConsentAt: null,
    whatsappConsentSource: null,
    whatsappOptedOutAt: null,
  };
  const open = [
    {
      businessPhoneNumberId: NUMBER_ID,
      customerPhoneE164: "+61412345678",
      lastInboundAt: now,
      windowExpiresAt: new Date(now.getTime() + 3_600_000),
    },
  ];

  const none = evaluateWhatsAppCallPermission({
    channel,
    conversations: open,
    lead,
    now,
    permission: null,
  });
  assert.deepEqual([none.canCall, none.canRequest], [false, true]);

  const closed = evaluateWhatsAppCallPermission({
    channel,
    conversations: [],
    lead,
    now,
    permission: null,
  });
  assert.equal(closed.canRequest, false);
  assert.match(closed.reason ?? "", /24 hours/);

  const askedToday = evaluateWhatsAppCallPermission({
    channel,
    conversations: open,
    lead,
    now,
    permission: {
      expiresAt: null,
      permanent: false,
      requestedAt: [new Date(now.getTime() - 3_600_000)],
      status: "REQUESTED",
    },
  });
  assert.equal(askedToday.canRequest, false, "one request a day");

  const granted = evaluateWhatsAppCallPermission({
    channel,
    conversations: [],
    lead,
    now,
    permission: {
      expiresAt: new Date(now.getTime() + 86_400_000),
      permanent: false,
      requestedAt: [],
      status: "GRANTED",
    },
  });
  assert.equal(granted.canCall, true, "a grant does not need the window");

  const lapsed = evaluateWhatsAppCallPermission({
    channel,
    conversations: open,
    lead,
    now,
    permission: {
      expiresAt: new Date(now.getTime() - 1),
      permanent: false,
      requestedAt: [],
      status: "GRANTED",
    },
  });
  assert.deepEqual(
    [lapsed.status, lapsed.canCall, lapsed.canRequest],
    ["EXPIRED", false, true],
  );

  const off = evaluateWhatsAppCallPermission({
    channel: { ...channel, callingEnabled: false },
    conversations: open,
    lead,
    now,
    permission: null,
  });
  assert.equal(off.enabled, false);
  assert.equal(off.canRequest, false);
});
