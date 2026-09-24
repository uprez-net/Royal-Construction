import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { beforeEach, describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { recordLeadWhatsAppConsent } from "@/lib/domain/leads/whatsapp/consent";
import {
  recordInboundLeadWhatsAppMessage,
  type InboundWhatsAppMessage,
} from "@/lib/domain/leads/whatsapp/inbound";
import {
  formatE164ForDisplay,
  leadPhoneE164,
  normaliseLeadPhone,
  waIdToE164,
} from "@/lib/domain/leads/whatsapp/phone";
import {
  chooseWhatsAppSender,
  CUSTOMER_SERVICE_WINDOW_MS,
  evaluateWhatsAppEligibility,
  WHATSAPP_REFUSALS,
  type WhatsAppPolicyLead,
} from "@/lib/domain/leads/whatsapp/policy";
import {
  getLeadWhatsAppThread,
  listLeadWhatsAppSummaries,
  markLeadWhatsAppRead,
} from "@/lib/domain/leads/whatsapp/queries";
import {
  reconcileLeadWhatsAppMessage,
  sendLeadWhatsAppMessage,
  whatsappOutboxKey,
} from "@/lib/domain/leads/whatsapp/send";
import {
  nextWhatsAppStatus,
  recordWhatsAppDeliveryStatus,
} from "@/lib/domain/leads/whatsapp/status";
import {
  findWhatsAppTemplate,
  prefillWhatsAppTemplateParameters,
  renderWhatsAppTemplate,
  validateWhatsAppTemplateParameters,
  WHATSAPP_TEMPLATES,
} from "@/lib/domain/leads/whatsapp/templates";
import {
  attachUnmatchedWhatsAppMessage,
  dismissUnmatchedWhatsAppMessage,
  listUnmatchedWhatsAppMessages,
} from "@/lib/domain/leads/whatsapp/unmatched";
import {
  WhatsAppSendError,
  type WhatsAppChannel,
  type WhatsAppPort,
  type WhatsAppTemplateMessage,
  type WhatsAppTextMessage,
} from "@/lib/domain/ports/whatsapp";
import { systemPrincipal, type DomainPrincipal } from "@/lib/domain/principal";

import { fakeWhatsAppDb, type FakeWhatsAppDb } from "./whatsapp-fake-db";

// Issue #333. The WhatsApp rules, run against an in-memory database so the
// second call sees what the first one wrote — a replay, a retry and a
// duplicate webhook are only meaningful that way.

const admin: DomainPrincipal = { kind: "user", role: Role.ADMIN, userId: "u_admin" };
const customer: DomainPrincipal = {
  kind: "user",
  role: Role.CUSTOMER,
  userId: "u_customer",
};
const webhook = systemPrincipal("whatsapp-webhook");

const OFFICE = {
  displayNumber: "+61280001234",
  label: "Office",
  phoneNumberId: "1000000000001",
};
const SALES = {
  displayNumber: "+61411000222",
  label: "Sales",
  phoneNumberId: "1000000000002",
};
const channel: WhatsAppChannel = {
  defaultPhoneNumberId: OFFICE.phoneNumberId,
  enabledTemplateNames: null,
  numbers: [OFFICE, SALES],
  sendingAvailable: true,
};

const NOW = new Date("2026-09-22T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

type Sent =
  | { kind: "text"; message: WhatsAppTextMessage }
  | { kind: "template"; message: WhatsAppTemplateMessage };

function fakePort(
  behaviour: (() => string | Error)[] = [],
): WhatsAppPort & { sent: Sent[] } {
  const sent: Sent[] = [];
  let call = 0;
  const next = () => {
    call += 1;
    const index = call;
    const outcome = behaviour[index - 1] ?? (() => `wamid.${index}`);
    const value = outcome();
    if (value instanceof Error) throw value;
    return { providerMessageId: value };
  };
  return {
    channel,
    sendTemplate: async (message) => {
      sent.push({ kind: "template", message });
      return next();
    },
    sendText: async (message) => {
      sent.push({ kind: "text", message });
      return next();
    },
    sent,
  };
}

let store: FakeWhatsAppDb;

function seedLead(overrides: Record<string, unknown> = {}) {
  const phone = (overrides.phone as string | undefined) ?? "0412 345 678";
  return store.seed("lead", {
    name: "Sam Carter",
    location: "Kellyville",
    phone,
    phoneE164: leadPhoneE164(phone),
    type: ["Double Storey"],
    ...overrides,
  });
}

function inbound(overrides: Partial<InboundWhatsAppMessage> = {}): InboundWhatsAppMessage {
  return {
    businessPhoneNumberId: OFFICE.phoneNumberId,
    fromWaId: "61412345678",
    profileName: "Sam",
    providerMessageId: "wamid.in.1",
    sentAt: new Date(NOW.getTime() - HOUR),
    text: "Hi, is Tuesday OK?",
    type: "text",
    ...overrides,
  };
}

beforeEach(() => {
  store = fakeWhatsAppDb();
  store.seed("user", { id: "u_admin", name: "Office Admin" });
});

// ───────────────────────────────────────────────────────────────────────────
describe("phone normalisation", () => {
  test("Australian numbers without a country code normalise to E.164", () => {
    assert.equal(normaliseLeadPhone("0412 345 678").e164, "+61412345678");
    assert.equal(normaliseLeadPhone("+61 412 345 678").e164, "+61412345678");
    assert.equal(normaliseLeadPhone("0061 412 345 678").e164, "+61412345678");
    assert.equal(normaliseLeadPhone("(02) 9876 5432").e164, "+61298765432");
    assert.equal(normaliseLeadPhone("+44 7911 123456").e164, "+447911123456");
  });

  test("a string with digits in it is not a usable phone", () => {
    for (const raw of ["", "   ", "0400 000 00", "call after 5pm", "12345"]) {
      const result = normaliseLeadPhone(raw);
      assert.equal(result.usable, false, raw);
      assert.equal(result.e164, null, raw);
      if (!result.usable) assert.ok(result.reason.length > 0);
    }
    assert.equal(leadPhoneE164("0400 000 00"), null);
  });

  test("a wa_id carries its own country code and is not re-read as Australian", () => {
    assert.equal(waIdToE164("61412345678"), "+61412345678");
    assert.equal(waIdToE164("447911123456"), "+447911123456");
    assert.equal(waIdToE164("0412345678"), null);
    assert.equal(waIdToE164(""), null);
    assert.equal(formatE164ForDisplay("+61412345678"), "+61 412 345 678");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("consent, window and template policy", () => {
  const baseLead: WhatsAppPolicyLead = {
    isArchived: false,
    phone: "0412 345 678",
    whatsappConsentAt: null,
    whatsappConsentSource: null,
    whatsappOptedOutAt: null,
  };
  const openWindow = [
    {
      businessPhoneNumberId: OFFICE.phoneNumberId,
      customerPhoneE164: "+61412345678",
      lastInboundAt: new Date(NOW.getTime() - HOUR),
      windowExpiresAt: new Date(NOW.getTime() - HOUR + CUSTOMER_SERVICE_WINDOW_MS),
    },
  ];

  test("with no window and no consent, nothing can be sent and the reason says why", () => {
    const result = evaluateWhatsAppEligibility({
      channel,
      conversations: [],
      lead: baseLead,
      now: NOW,
    });
    assert.equal(result.text.allowed, false);
    assert.equal(result.text.reason, WHATSAPP_REFUSALS.windowClosed);
    assert.equal(result.template.allowed, false);
    assert.equal(result.template.reason, WHATSAPP_REFUSALS.noConsent);
  });

  test("recorded consent allows a template but not free text outside the window", () => {
    const result = evaluateWhatsAppEligibility({
      channel,
      conversations: [],
      lead: { ...baseLead, whatsappConsentAt: NOW, whatsappConsentSource: "VERBAL" },
      now: NOW,
    });
    assert.equal(result.template.allowed, true);
    assert.equal(result.text.allowed, false);
  });

  test("a customer-opened window allows free text and templates without consent", () => {
    const result = evaluateWhatsAppEligibility({
      channel,
      conversations: openWindow,
      lead: baseLead,
      now: NOW,
    });
    assert.equal(result.window.open, true);
    assert.equal(result.text.allowed, true);
    assert.equal(result.template.allowed, true);
  });

  test("the window closes after the modelled period", () => {
    const later = new Date(NOW.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
    const result = evaluateWhatsAppEligibility({
      channel,
      conversations: openWindow,
      lead: baseLead,
      now: later,
    });
    assert.equal(result.window.open, false);
    assert.equal(result.text.allowed, false);
  });

  test("archived, opted-out, unusable phone and no provider each block everything", () => {
    const cases: [Partial<WhatsAppPolicyLead>, WhatsAppChannel | null, string][] = [
      [{ isArchived: true }, channel, WHATSAPP_REFUSALS.archived],
      [{ whatsappOptedOutAt: NOW }, channel, WHATSAPP_REFUSALS.optedOut],
      [{}, { ...channel, sendingAvailable: false }, WHATSAPP_REFUSALS.noSending],
      [{}, null, WHATSAPP_REFUSALS.noSender],
    ];
    for (const [patch, withChannel, reason] of cases) {
      const result = evaluateWhatsAppEligibility({
        channel: withChannel,
        conversations: openWindow,
        lead: { ...baseLead, ...patch },
        now: NOW,
      });
      assert.equal(result.text.reason, reason);
      assert.equal(result.template.reason, reason);
    }
    const noPhone = evaluateWhatsAppEligibility({
      channel,
      conversations: openWindow,
      lead: { ...baseLead, phone: "not a number" },
      now: NOW,
    });
    assert.equal(noPhone.text.allowed, false);
    assert.equal(noPhone.template.reason, noPhone.phone.usable ? null : noPhone.phone.reason);
  });

  test("the sender is the number with an open window, else the default; unknown overrides refuse", () => {
    const toSales = [{ ...openWindow[0], businessPhoneNumberId: SALES.phoneNumberId }];
    assert.equal(
      chooseWhatsAppSender(channel, toSales, "+61412345678", NOW)?.phoneNumberId,
      SALES.phoneNumberId,
    );
    assert.equal(
      chooseWhatsAppSender(channel, [], "+61412345678", NOW)?.phoneNumberId,
      OFFICE.phoneNumberId,
    );
    assert.throws(
      () => chooseWhatsAppSender(channel, [], "+61412345678", NOW, "999"),
      DomainValidationError,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("template catalogue", () => {
  const template = WHATSAPP_TEMPLATES[0];

  test("renders the approved body with the variables in order", () => {
    assert.equal(
      renderWhatsAppTemplate(template, ["Sam", "your new home"]),
      template.body.replace("{{1}}", "Sam").replace("{{2}}", "your new home"),
    );
  });

  test("refuses the variables Meta would refuse, before anything is sent", () => {
    assert.throws(() => validateWhatsAppTemplateParameters(template, ["Sam"]), DomainValidationError);
    assert.throws(() => validateWhatsAppTemplateParameters(template, ["Sam", "  "]), DomainValidationError);
    assert.throws(
      () => validateWhatsAppTemplateParameters(template, ["Sam", "line\nbreak"]),
      DomainValidationError,
    );
    assert.deepEqual(
      validateWhatsAppTemplateParameters(template, [" Sam ", "a home"]),
      ["Sam", "a home"],
    );
  });

  test("prefills from the lead and every catalogue entry is well formed", () => {
    assert.deepEqual(
      prefillWhatsAppTemplateParameters(template, {
        location: "Kellyville",
        name: "Sam Carter",
        type: ["Double Storey"],
      }),
      ["Sam", "your double storey in Kellyville"],
    );
    for (const entry of WHATSAPP_TEMPLATES) {
      const placeholders = entry.body.match(/\{\{\d+\}\}/g) ?? [];
      assert.equal(new Set(placeholders).size, entry.parameters.length, entry.name);
      assert.equal(findWhatsAppTemplate(entry.name), entry);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("sending", () => {
  const template = WHATSAPP_TEMPLATES[0];
  const templateMessage = {
    kind: "template" as const,
    parameters: ["Sam", "your new home"],
    templateName: template.name,
  };

  test("a consented template goes to the lead's own number, once, and is recorded", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW, whatsappConsentSource: "VERBAL" });
    const port = fakePort();
    const result = await sendLeadWhatsAppMessage(
      admin,
      { idempotencyKey: "k1", leadId: lead.id as number, message: templateMessage, now: NOW },
      store.transactionalDb,
      { whatsapp: port },
    );

    assert.equal(result.alreadySent, false);
    assert.equal(result.message.status, "SENT");
    assert.equal(result.message.businessPhoneNumberId, OFFICE.phoneNumberId);
    assert.equal(result.message.authorName, "Office Admin");
    assert.equal(port.sent.length, 1);
    assert.equal(port.sent[0].message.to, "+61412345678");
    assert.equal(port.sent[0].kind, "template");

    const [message] = store.rows("leadWhatsAppMessage");
    assert.equal(message.providerMessageId, "wamid.1");
    assert.equal(message.idempotencyKey, whatsappOutboxKey(lead.id as number, "k1"));
    const [intent] = store.rows("outboxEvent");
    assert.equal(intent.status, "SUCCEEDED");
    assert.equal(intent.kind, "LEAD_WHATSAPP_SEND");
    const history = store.rows("leadHistory");
    assert.equal(history.length, 1);
    assert.equal(history[0].type, "WHATSAPP");
    // The body lives on the message, not in history.
    assert.doesNotMatch(String(history[0].detail), /your new home/);
  });

  test("a double-click or retry with the same key reports the earlier send and sends nothing", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW, whatsappConsentSource: "VERBAL" });
    const port = fakePort();
    const input = { idempotencyKey: "k1", leadId: lead.id as number, message: templateMessage, now: NOW };
    await sendLeadWhatsAppMessage(admin, input, store.transactionalDb, { whatsapp: port });
    const replay = await sendLeadWhatsAppMessage(admin, input, store.transactionalDb, {
      whatsapp: port,
    });

    assert.equal(replay.alreadySent, true);
    assert.equal(port.sent.length, 1);
    assert.equal(store.rows("leadWhatsAppMessage").length, 1);
    assert.equal(store.rows("leadHistory").length, 1);
  });

  test("a new key is a new message", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW, whatsappConsentSource: "VERBAL" });
    const port = fakePort();
    for (const key of ["k1", "k2"]) {
      await sendLeadWhatsAppMessage(
        admin,
        { idempotencyKey: key, leadId: lead.id as number, message: templateMessage, now: NOW },
        store.transactionalDb,
        { whatsapp: port },
      );
    }
    assert.equal(port.sent.length, 2);
    assert.equal(store.rows("leadWhatsAppMessage").length, 2);
  });

  test("refusals write nothing and call nobody", async () => {
    const lead = seedLead();
    const archived = seedLead({ isArchived: true, whatsappConsentAt: NOW });
    const port = fakePort();
    const attempts: [DomainPrincipal, Record<string, unknown>, WhatsAppPort | null, new (...args: never[]) => Error][] = [
      // Free text with no window open.
      [admin, { leadId: lead.id, message: { body: "Hi", kind: "text" } }, port, DomainTransitionError],
      // A template with no consent and no window.
      [admin, { leadId: lead.id, message: templateMessage }, port, DomainTransitionError],
      [admin, { leadId: archived.id, message: templateMessage }, port, DomainTransitionError],
      [customer, { leadId: lead.id, message: templateMessage }, port, DomainAuthorizationError],
      [webhook, { leadId: lead.id, message: templateMessage }, port, DomainAuthorizationError],
      [admin, { idempotencyKey: "  ", leadId: lead.id, message: templateMessage }, port, DomainValidationError],
      [admin, { leadId: 999, message: templateMessage }, port, DomainNotFoundError],
      // The provider is unreachable from this runtime (Eve without a token).
      [admin, { leadId: lead.id, message: templateMessage }, null, DomainSideEffectError],
    ];
    for (const [principal, input, whatsapp, error] of attempts) {
      await assert.rejects(
        sendLeadWhatsAppMessage(
          principal,
          { idempotencyKey: "k1", now: NOW, ...input } as never,
          store.transactionalDb,
          { whatsapp },
        ),
        error,
      );
    }
    assert.deepEqual(store.log, []);
    assert.equal(port.sent.length, 0);
  });

  test("provider unavailable says nothing was sent and points at the App", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW });
    await assert.rejects(
      sendLeadWhatsAppMessage(
        admin,
        { idempotencyKey: "k1", leadId: lead.id as number, message: templateMessage, now: NOW },
        store.transactionalDb,
        {},
      ),
      (error: unknown) =>
        error instanceof DomainSideEffectError
        && /nothing was sent/i.test(error.message)
        && /app/i.test(error.message),
    );
  });

  test("an unknown or unapproved template is refused", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW });
    const narrowed = { ...fakePort(), channel: { ...channel, enabledTemplateNames: [] } };
    await assert.rejects(
      sendLeadWhatsAppMessage(
        admin,
        { idempotencyKey: "k1", leadId: lead.id as number, message: templateMessage, now: NOW },
        store.transactionalDb,
        { whatsapp: narrowed },
      ),
      DomainValidationError,
    );
    await assert.rejects(
      sendLeadWhatsAppMessage(
        admin,
        {
          idempotencyKey: "k2",
          leadId: lead.id as number,
          message: { ...templateMessage, templateName: "made_up" },
          now: NOW,
        },
        store.transactionalDb,
        { whatsapp: fakePort() },
      ),
      DomainValidationError,
    );
  });

  test("a definite refusal marks the message failed and the same key may retry", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW });
    const port = fakePort([
      () => new WhatsAppSendError("WhatsApp's sending rate limit was reached.", "not_sent", { code: "130429" }),
    ]);
    const input = { idempotencyKey: "k1", leadId: lead.id as number, message: templateMessage, now: NOW };

    await assert.rejects(
      sendLeadWhatsAppMessage(admin, input, store.transactionalDb, { whatsapp: port }),
      (error: unknown) =>
        error instanceof DomainSideEffectError
        && error.retryable
        && /^Nothing was sent/.test(error.message),
    );
    assert.equal(store.rows("leadWhatsAppMessage")[0].status, "FAILED");
    assert.equal(store.rows("leadWhatsAppMessage")[0].providerErrorCode, "130429");
    assert.equal(store.rows("outboxEvent")[0].status, "PENDING");

    const retried = await sendLeadWhatsAppMessage(admin, input, store.transactionalDb, {
      whatsapp: port,
    });
    assert.equal(retried.alreadySent, false);
    assert.equal(retried.message.status, "SENT");
    assert.equal(port.sent.length, 2);
    assert.equal(store.rows("leadWhatsAppMessage").length, 1);
  });

  test("an ambiguous failure is held for reconciliation and never retried blindly", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW });
    const port = fakePort([
      () => new WhatsAppSendError("timed out", "ambiguous"),
    ]);
    const input = { idempotencyKey: "k1", leadId: lead.id as number, message: templateMessage, now: NOW };

    await assert.rejects(
      sendLeadWhatsAppMessage(admin, input, store.transactionalDb, { whatsapp: port }),
      (error: unknown) => error instanceof DomainSideEffectError && !error.retryable,
    );
    const [message] = store.rows("leadWhatsAppMessage");
    assert.equal(message.needsReconciliation, true);
    assert.equal(message.status, "QUEUED");
    assert.equal(store.rows("outboxEvent")[0].status, "FAILED");

    await assert.rejects(
      sendLeadWhatsAppMessage(admin, input, store.transactionalDb, { whatsapp: port }),
      DomainTransitionError,
    );
    assert.equal(port.sent.length, 1);

    const settled = await reconcileLeadWhatsAppMessage(
      admin,
      { leadId: lead.id as number, messageId: message.id as string, outcome: "not_sent" },
      store.transactionalDb,
    );
    assert.equal(settled.status, "FAILED");
    assert.equal(settled.needsReconciliation, false);
    await assert.rejects(
      reconcileLeadWhatsAppMessage(
        admin,
        { leadId: lead.id as number, messageId: message.id as string, outcome: "sent" },
        store.transactionalDb,
      ),
      DomainTransitionError,
    );
  });

  test("an attempt that died mid-send is held for reconciliation once its lock is stale", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW });
    // The first attempt claims the intent and never hears back: the process
    // running it died with the provider call in flight.
    const sent: Sent[] = [];
    const hung: WhatsAppPort = {
      channel,
      sendTemplate: (message) => {
        sent.push({ kind: "template", message });
        return new Promise(() => undefined);
      },
      sendText: () => new Promise(() => undefined),
    };
    const key = "k1";
    void sendLeadWhatsAppMessage(
      admin,
      { idempotencyKey: key, leadId: lead.id as number, message: templateMessage, now: NOW },
      store.transactionalDb,
      { whatsapp: hung },
    );
    for (let i = 0; i < 50 && sent.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(sent.length, 1);
    const lockedAt = store.rows("outboxEvent")[0].lockedAt as Date;
    const port = fakePort();
    const retry = (now: Date) =>
      sendLeadWhatsAppMessage(
        admin,
        { idempotencyKey: key, leadId: lead.id as number, message: templateMessage, now },
        store.transactionalDb,
        { whatsapp: port },
      );

    // Still inside the provider timeout: genuinely in flight.
    await assert.rejects(
      retry(new Date(lockedAt.getTime() + 20_000)),
      /already being sent/,
    );
    assert.equal(store.rows("leadWhatsAppMessage")[0].needsReconciliation, false);

    // Well past it: nothing will ever record the outcome, so a person must.
    await assert.rejects(
      retry(new Date(lockedAt.getTime() + 5 * 60_000)),
      (error: unknown) => error instanceof DomainSideEffectError && !error.retryable,
    );
    const [message] = store.rows("leadWhatsAppMessage");
    assert.equal(message.needsReconciliation, true);
    assert.equal(store.rows("outboxEvent")[0].status, "FAILED");
    assert.equal(port.sent.length, 0);

    const settled = await reconcileLeadWhatsAppMessage(
      admin,
      { leadId: lead.id as number, messageId: message.id as string, outcome: "sent" },
      store.transactionalDb,
    );
    assert.equal(settled.status, "SENT");
  });

  test("a status callback that beat the send is applied when the send stores the wamid", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW });
    const early = await recordWhatsAppDeliveryStatus(
      webhook,
      { occurredAt: NOW, providerMessageId: "wamid.early", status: "DELIVERED" },
      store.transactionalDb,
    );
    assert.equal(early.outcome, "awaiting_message");

    const result = await sendLeadWhatsAppMessage(
      admin,
      { idempotencyKey: "k1", leadId: lead.id as number, message: templateMessage, now: NOW },
      store.transactionalDb,
      { whatsapp: fakePort([() => "wamid.early"]) },
    );
    assert.equal(result.message.status, "DELIVERED");
    assert.ok(store.rows("whatsAppStatusEvent")[0].appliedAt);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("inbound messages", () => {
  test("a message from exactly one lead's number is filed once and opens the window", async () => {
    const lead = seedLead();
    const first = await recordInboundLeadWhatsAppMessage(webhook, inbound(), store.transactionalDb, {
      channel,
    });
    assert.equal(first.outcome, "attached");
    const replay = await recordInboundLeadWhatsAppMessage(webhook, inbound(), store.transactionalDb, {
      channel,
    });
    assert.equal(replay.outcome, "duplicate");

    assert.equal(store.rows("leadWhatsAppMessage").length, 1);
    const [conversation] = store.rows("leadWhatsAppConversation");
    assert.equal(conversation.leadId, lead.id);
    assert.equal(conversation.unreadCount, 1);
    assert.equal(
      (conversation.windowExpiresAt as Date).getTime(),
      NOW.getTime() - HOUR + CUSTOMER_SERVICE_WINDOW_MS,
    );

    // With the window open, free text is allowed without recorded consent.
    const sent = await sendLeadWhatsAppMessage(
      admin,
      { idempotencyKey: "reply", leadId: lead.id as number, message: { body: "Tuesday works", kind: "text" }, now: NOW },
      store.transactionalDb,
      { whatsapp: fakePort() },
    );
    assert.equal(sent.message.kind, "TEXT");
    assert.equal(store.rows("leadWhatsAppConversation").length, 1);
  });

  test("a unique clash that stored nothing is rethrown for Meta to redeliver, not called a duplicate", async () => {
    seedLead();
    // Another message from the same customer created the conversation first.
    const clash = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const racing: typeof store.transactionalDb = new Proxy(store.transactionalDb, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "$transaction") {
          // The fake hands its own client to the callback; hand this one.
          return (fn: (tx: typeof racing) => Promise<unknown>) =>
            target.$transaction(() => fn(racing));
        }
        if (property !== "leadWhatsAppConversation") return value;
        return { ...value, upsert: async () => Promise.reject(clash) };
      },
    });
    await assert.rejects(
      recordInboundLeadWhatsAppMessage(webhook, inbound(), racing, { channel }),
      (error: unknown) => error === clash,
    );
    assert.equal(store.rows("leadWhatsAppMessage").length, 0);

    // Redelivered, it is filed.
    const redelivered = await recordInboundLeadWhatsAppMessage(
      webhook,
      inbound(),
      store.transactionalDb,
      { channel },
    );
    assert.equal(redelivered.outcome, "attached");
  });

  test("unknown, ambiguous and misrouted messages are kept for review, never attached", async () => {
    seedLead({ name: "A", phone: "0412 000 111" });
    seedLead({ name: "B", phone: "+61 412 000 111" });

    const none = await recordInboundLeadWhatsAppMessage(
      webhook,
      inbound({ fromWaId: "61499999999", providerMessageId: "w.none" }),
      store.transactionalDb,
      { channel },
    );
    const two = await recordInboundLeadWhatsAppMessage(
      webhook,
      inbound({ fromWaId: "61412000111", providerMessageId: "w.two" }),
      store.transactionalDb,
      { channel },
    );
    const misrouted = await recordInboundLeadWhatsAppMessage(
      webhook,
      inbound({ businessPhoneNumberId: "555", providerMessageId: "w.misrouted" }),
      store.transactionalDb,
      { channel },
    );

    assert.deepEqual(
      [none, two, misrouted].map((result) => result.outcome === "unmatched" && result.reason),
      ["NO_MATCH", "AMBIGUOUS", "UNKNOWN_BUSINESS_NUMBER"],
    );
    assert.equal(store.rows("leadWhatsAppMessage").length, 0);
    const ambiguous = store.rows("whatsAppUnmatchedMessage")[1];
    assert.deepEqual(ambiguous.candidateLeadIds, [1, 2]);
  });

  test("an unsupported message type is kept with a placeholder, not dropped", async () => {
    seedLead();
    await recordInboundLeadWhatsAppMessage(
      webhook,
      inbound({ text: null, type: "image" }),
      store.transactionalDb,
      { channel },
    );
    const [message] = store.rows("leadWhatsAppMessage");
    assert.equal(message.kind, "UNSUPPORTED");
    assert.match(String(message.body), /image message/);
  });

  test("only the verified webhook may say a customer wrote in", async () => {
    seedLead();
    for (const principal of [admin, customer]) {
      await assert.rejects(
        recordInboundLeadWhatsAppMessage(principal, inbound(), store.transactionalDb, { channel }),
        DomainAuthorizationError,
      );
    }
    assert.deepEqual(store.log, []);
  });

  test("a person can attach or dismiss an unmatched message, once", async () => {
    const lead = seedLead({ phone: "0400 000 00" }); // unusable, so unmatched
    await recordInboundLeadWhatsAppMessage(webhook, inbound(), store.transactionalDb, { channel });
    await recordInboundLeadWhatsAppMessage(
      webhook,
      inbound({ providerMessageId: "wamid.in.2" }),
      store.transactionalDb,
      { channel },
    );
    const queue = await listUnmatchedWhatsAppMessages(admin, {}, store.db, { channel });
    assert.equal(queue.pendingCount, 2);
    assert.equal(queue.items[0].businessLabel, "Office");

    const [first, second] = store.rows("whatsAppUnmatchedMessage");
    const attached = await attachUnmatchedWhatsAppMessage(
      admin,
      { leadId: lead.id as number, unmatchedId: first.id as string },
      store.transactionalDb,
      { channel },
    );
    assert.equal(attached.leadId, lead.id);
    assert.equal(store.rows("leadWhatsAppMessage").length, 1);
    assert.equal(store.rows("whatsAppUnmatchedMessage")[0].status, "ATTACHED");
    await assert.rejects(
      attachUnmatchedWhatsAppMessage(
        admin,
        { leadId: lead.id as number, unmatchedId: first.id as string },
        store.transactionalDb,
        { channel },
      ),
      DomainTransitionError,
    );

    await dismissUnmatchedWhatsAppMessage(admin, { unmatchedId: second.id as string }, store.db);
    assert.equal(store.rows("whatsAppUnmatchedMessage")[1].status, "DISMISSED");
    await assert.rejects(
      dismissUnmatchedWhatsAppMessage(customer, { unmatchedId: second.id as string }, store.db),
      DomainAuthorizationError,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("delivery statuses", () => {
  test("statuses only move forward and nothing leaves READ or FAILED", () => {
    assert.equal(nextWhatsAppStatus("QUEUED", "SENT"), "SENT");
    assert.equal(nextWhatsAppStatus("SENT", "READ"), "READ");
    assert.equal(nextWhatsAppStatus("READ", "DELIVERED"), null);
    assert.equal(nextWhatsAppStatus("DELIVERED", "SENT"), null);
    assert.equal(nextWhatsAppStatus("SENT", "FAILED"), "FAILED");
    assert.equal(nextWhatsAppStatus("READ", "FAILED"), null);
    assert.equal(nextWhatsAppStatus("FAILED", "DELIVERED"), null);
    assert.equal(nextWhatsAppStatus("RECEIVED", "READ"), null);
  });

  test("callbacks are idempotent, out-of-order safe and webhook-only", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW });
    await sendLeadWhatsAppMessage(
      admin,
      {
        idempotencyKey: "k1",
        leadId: lead.id as number,
        message: { kind: "template", parameters: ["Sam", "x"], templateName: WHATSAPP_TEMPLATES[0].name },
        now: NOW,
      },
      store.transactionalDb,
      { whatsapp: fakePort([() => "wamid.s"]) },
    );
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const record = (status: "SENT" | "DELIVERED" | "READ" | "FAILED", minutes: number) =>
      recordWhatsAppDeliveryStatus(
        webhook,
        { occurredAt: at(minutes), providerMessageId: "wamid.s", status },
        store.transactionalDb,
      );

    assert.equal((await record("READ", 3)).outcome, "applied");
    assert.equal((await record("DELIVERED", 2)).outcome, "stale");
    assert.equal((await record("DELIVERED", 2)).outcome, "duplicate");
    assert.equal((await record("FAILED", 4)).outcome, "stale");

    const [message] = store.rows("leadWhatsAppMessage");
    assert.equal(message.status, "READ");
    assert.equal((message.deliveredAt as Date).getTime(), at(2).getTime());

    await assert.rejects(
      recordWhatsAppDeliveryStatus(
        admin,
        { occurredAt: NOW, providerMessageId: "wamid.s", status: "READ" },
        store.transactionalDb,
      ),
      DomainAuthorizationError,
    );
  });

  test("a failure callback records Meta's reason on the message", async () => {
    const lead = seedLead({ whatsappConsentAt: NOW });
    await sendLeadWhatsAppMessage(
      admin,
      {
        idempotencyKey: "k1",
        leadId: lead.id as number,
        message: { kind: "template", parameters: ["Sam", "x"], templateName: WHATSAPP_TEMPLATES[0].name },
        now: NOW,
      },
      store.transactionalDb,
      { whatsapp: fakePort([() => "wamid.f"]) },
    );
    await recordWhatsAppDeliveryStatus(
      webhook,
      {
        errorCode: "131026",
        errorTitle: "Not on WhatsApp",
        occurredAt: NOW,
        providerMessageId: "wamid.f",
        status: "FAILED",
      },
      store.transactionalDb,
    );
    const [message] = store.rows("leadWhatsAppMessage");
    assert.equal(message.status, "FAILED");
    assert.equal(message.providerErrorCode, "131026");
    assert.equal(message.providerErrorTitle, "Not on WhatsApp");
  });
});

describe("WhatsApp fake DB pagination", () => {
  test("rejects pagination the in-memory adapter cannot model", async () => {
    const { db } = fakeWhatsAppDb();

    await assert.rejects(db.lead.findMany({ skip: 1 }), /unsupported-pagination/);
    await assert.rejects(db.lead.findMany({ cursor: { id: 1 } }), /unsupported-pagination/);
    await assert.rejects(db.lead.findMany({ distinct: ["id"] }), /unsupported-pagination/);
    await assert.rejects(db.lead.findMany({ take: -1 }), /unsupported-pagination/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("consent and reads", () => {
  test("recording consent enables a template; an opt-out blocks everything again", async () => {
    const lead = seedLead();
    const port = fakePort();
    const send = (key: string) =>
      sendLeadWhatsAppMessage(
        admin,
        {
          idempotencyKey: key,
          leadId: lead.id as number,
          message: { kind: "template", parameters: ["Sam"], templateName: "lead_missed_contact" },
          now: NOW,
        },
        store.transactionalDb,
        { whatsapp: port },
      );

    await assert.rejects(send("a"), DomainTransitionError);
    const granted = await recordLeadWhatsAppConsent(
      admin,
      { action: "grant", leadId: lead.id as number, note: "On the phone", source: "VERBAL" },
      store.transactionalDb,
    );
    assert.ok(granted.consentAt);
    assert.equal(store.rows("lead")[0].whatsappConsentRecordedById, "u_admin");
    await send("b");

    await recordLeadWhatsAppConsent(
      admin,
      { action: "opt_out", leadId: lead.id as number },
      store.transactionalDb,
    );
    await assert.rejects(send("c"), (error: unknown) =>
      error instanceof DomainTransitionError && error.message === WHATSAPP_REFUSALS.optedOut,
    );
    assert.equal(port.sent.length, 1);
    await assert.rejects(
      recordLeadWhatsAppConsent(
        customer,
        { action: "grant", leadId: lead.id as number, source: "VERBAL" },
        store.transactionalDb,
      ),
      DomainAuthorizationError,
    );
  });

  test("the thread pages oldest-first and reports eligibility; summaries stay small", async () => {
    const lead = seedLead();
    for (let i = 0; i < 5; i += 1) {
      await recordInboundLeadWhatsAppMessage(
        webhook,
        inbound({
          providerMessageId: `w.${i}`,
          sentAt: new Date(NOW.getTime() - (10 - i) * 60_000),
          text: `message ${i}`,
        }),
        store.transactionalDb,
        { channel },
      );
    }

    const latest = await getLeadWhatsAppThread(
      admin,
      { leadId: lead.id as number, limit: 2, now: NOW },
      store.db,
      { channel },
    );
    assert.deepEqual(latest.messages.map((m) => m.body), ["message 3", "message 4"]);
    assert.ok(latest.olderCursor);
    assert.equal(latest.eligibility.text.allowed, true);
    assert.equal(latest.unreadCount, 5);
    assert.equal(latest.templates.length, WHATSAPP_TEMPLATES.length);

    const older = await getLeadWhatsAppThread(
      admin,
      { before: latest.olderCursor, leadId: lead.id as number, limit: 2, now: NOW },
      store.db,
      { channel },
    );
    assert.deepEqual(older.messages.map((m) => m.body), ["message 1", "message 2"]);

    const [summary] = await listLeadWhatsAppSummaries(
      admin,
      { leadIds: [lead.id as number], now: NOW },
      store.db,
    );
    assert.equal(summary.unreadCount, 5);
    assert.equal(summary.windowOpen, true);
    assert.equal(summary.lastDirection, "INBOUND");
    assert.equal(summary.phoneE164, "+61412345678");

    await markLeadWhatsAppRead(admin, { leadId: lead.id as number }, store.db);
    const [after] = await listLeadWhatsAppSummaries(
      admin,
      { leadIds: [lead.id as number], now: NOW },
      store.db,
    );
    assert.equal(after.unreadCount, 0);

    await assert.rejects(
      getLeadWhatsAppThread(customer, { leadId: lead.id as number }, store.db, { channel }),
      DomainAuthorizationError,
    );
  });
});
