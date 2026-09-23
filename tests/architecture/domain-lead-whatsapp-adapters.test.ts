import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Role } from "@prisma/client";
import { beforeEach, describe, test } from "vitest";

import { sendLeadWhatsAppMessageInputSchema } from "@/agent/lib/lead-whatsapp-contracts";
import {
  whatsappIdempotencyKey,
  whatsappSendEnvelope,
} from "@/agent/lib/lead-whatsapp-envelopes";
import { isDomainError } from "@/lib/domain/errors";
import { leadPhoneE164 } from "@/lib/domain/leads/whatsapp/phone";
import { WHATSAPP_REFUSALS } from "@/lib/domain/leads/whatsapp/policy";
import {
  sendLeadWhatsAppMessage,
  type SendLeadWhatsAppResult,
} from "@/lib/domain/leads/whatsapp/send";
import { WHATSAPP_TEMPLATES } from "@/lib/domain/leads/whatsapp/templates";
import type { WhatsAppPort } from "@/lib/domain/ports/whatsapp";
import { userPrincipal } from "@/lib/domain/principal";

import { fakeWhatsAppDb, type FakeWhatsAppDb } from "./whatsapp-fake-db";

// The acceptance test issue #333 asks for: the same domain command, reached
// from an App-style adapter and an Eve-style adapter, gives identical
// authorization, eligibility, idempotency and persisted-message outcomes.
//
// Each adapter is driven the way it really translates its transport:
//
//   App — the route's body shape ({kind, body} | {kind, templateName,
//         parameters}), the key from the `Idempotency-Key` header, the
//         principal from the signed-in User row.
//   Eve — the tool's own Zod contract (`sendLeadWhatsAppMessageInputSchema`),
//         the key from the tool call id (`whatsappIdempotencyKey`), the
//         principal from the session actor, and the result through the real
//         envelope mapper, so "sent" is only ever said when the domain says so.
//
// The source checks at the bottom pin that the real route and the real Eve
// operation still make exactly that call, so this cannot silently drift into
// testing a copy.

const staffUser = { id: "u_admin", role: Role.ADMIN };
const customerUser = { id: "u_customer", role: Role.CUSTOMER };
const channel = {
  defaultPhoneNumberId: "1000000000001",
  enabledTemplateNames: null,
  numbers: [
    { displayNumber: "+61280001234", label: "Office", phoneNumberId: "1000000000001" },
  ],
  sendingAvailable: true,
};

type Outcome =
  | { ok: true; result: SendLeadWhatsAppResult }
  | { ok: false; code: string; message: string };

function recordingPort(): WhatsAppPort & { sends: number } {
  const port = {
    channel,
    sends: 0,
    sendTemplate: async () => ({ providerMessageId: `wamid.${++port.sends}` }),
    sendText: async () => ({ providerMessageId: `wamid.${++port.sends}` }),
  };
  return port;
}

type Request = {
  user: { id: string; role: Role };
  leadId: number;
  attempt: string;
  message:
    | { kind: "text"; body: string }
    | { kind: "template"; templateName: string; parameters: string[] };
};

/** What app/api/(data)/leads/[leadId]/whatsapp/messages/route.ts does. */
async function viaApp(store: FakeWhatsAppDb, port: WhatsAppPort, request: Request): Promise<Outcome> {
  const body = request.message;
  try {
    const result = await sendLeadWhatsAppMessage(
      userPrincipal(request.user),
      {
        businessPhoneNumberId: null,
        idempotencyKey: request.attempt,
        leadId: request.leadId,
        message:
          body.kind === "text"
            ? { body: body.body, kind: "text" }
            : { kind: "template", parameters: body.parameters, templateName: body.templateName },
      },
      store.transactionalDb,
      { whatsapp: port },
    );
    return { ok: true, result };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { code: error.code, message: error.message, ok: false };
  }
}

/** What agent/lib/lead-whatsapp-operations.ts#sendAuthorizedLeadWhatsAppMessage does. */
async function viaEve(store: FakeWhatsAppDb, port: WhatsAppPort, request: Request): Promise<Outcome> {
  const input = sendLeadWhatsAppMessageInputSchema.parse(
    request.message.kind === "text"
      ? { body: request.message.body, leadId: request.leadId, mode: "text" }
      : {
          leadId: request.leadId,
          mode: "template",
          templateName: request.message.templateName,
          templateParameters: request.message.parameters,
        },
  );
  const lead = { id: request.leadId, name: "Sam Carter" };
  try {
    const result = await sendLeadWhatsAppMessage(
      userPrincipal(request.user),
      {
        businessPhoneNumberId: input.businessPhoneNumberId ?? null,
        idempotencyKey: whatsappIdempotencyKey({ callId: request.attempt }),
        leadId: input.leadId,
        message:
          input.mode === "text"
            ? { body: input.body ?? "", kind: "text" }
            : {
                kind: "template",
                parameters: input.templateParameters ?? [],
                templateName: input.templateName ?? "",
              },
      },
      store.transactionalDb,
      { whatsapp: port },
    );
    // The envelope must agree with the domain about whether anything went out.
    const envelope = whatsappSendEnvelope(lead, { ok: true, result });
    assert.notEqual(envelope, "forbidden");
    if (envelope !== "forbidden") {
      assert.equal(envelope.data.sent, !result.alreadySent);
      assert.equal(envelope.data.alreadySent, result.alreadySent);
    }
    return { ok: true, result };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const envelope = whatsappSendEnvelope(lead, { error, ok: false, providerAvailable: true });
    if (envelope !== "forbidden") {
      assert.equal(envelope.kind, "error");
      assert.equal(envelope.summary, error.message);
    }
    return { code: error.code, message: error.message, ok: false };
  }
}

/** The persisted state, minus ids, keys and clock readings. */
function snapshot(store: FakeWhatsAppDb) {
  const strip = (row: Record<string, unknown>, drop: string[]) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !drop.includes(key)));
  const volatile = ["id", "createdAt", "updatedAt"];
  return {
    conversations: store
      .rows("leadWhatsAppConversation")
      .map((row) => strip(row, [...volatile, "lastMessageAt", "lastOutboundAt"])),
    history: store
      .rows("leadHistory")
      .map((row) => strip(row, [...volatile, "actionDate"])),
    messages: store
      .rows("leadWhatsAppMessage")
      .map((row) => strip(row, [...volatile, "conversationId", "idempotencyKey", "occurredAt", "statusAt"])),
    outbox: store
      .rows("outboxEvent")
      .map((row) => strip(row, [...volatile, "key", "availableAt", "completedAt", "lockedAt", "result"])),
  };
}

function freshStore() {
  const store = fakeWhatsAppDb();
  store.seed("user", { id: "u_admin", name: "Office Admin" });
  store.seed("lead", {
    location: "Kellyville",
    name: "Sam Carter",
    phone: "0412 345 678",
    phoneE164: leadPhoneE164("0412 345 678"),
    type: ["Double Storey"],
    whatsappConsentAt: new Date("2026-09-01T00:00:00.000Z"),
    whatsappConsentSource: "VERBAL",
  });
  return store;
}

const template = WHATSAPP_TEMPLATES[0];
const templateMessage = {
  kind: "template" as const,
  parameters: ["Sam", "your new home"],
  templateName: template.name,
};

describe("App and Eve reach the same WhatsApp send", () => {
  let appStore: FakeWhatsAppDb;
  let eveStore: FakeWhatsAppDb;

  beforeEach(() => {
    appStore = freshStore();
    eveStore = freshStore();
  });

  test("the same scenario produces the same outcomes and the same rows", async () => {
    const appPort = recordingPort();
    const evePort = recordingPort();
    const scenario: Request[] = [
      // A customer account is refused by both.
      { attempt: "a0", leadId: 1, message: templateMessage, user: customerUser },
      // Free text with no open window: refused by both, same sentence.
      { attempt: "a1", leadId: 1, message: { body: "Hi Sam", kind: "text" }, user: staffUser },
      // A consented template: sent by both.
      { attempt: "a2", leadId: 1, message: templateMessage, user: staffUser },
      // The same attempt again (double click / retried tool call): replayed.
      { attempt: "a2", leadId: 1, message: templateMessage, user: staffUser },
      // A lead that does not exist.
      { attempt: "a3", leadId: 99, message: templateMessage, user: staffUser },
    ];

    const appOutcomes: Outcome[] = [];
    const eveOutcomes: Outcome[] = [];
    for (const request of scenario) {
      appOutcomes.push(await viaApp(appStore, appPort, request));
      eveOutcomes.push(await viaEve(eveStore, evePort, request));
    }

    const comparable = (outcome: Outcome) =>
      outcome.ok
        ? {
            alreadySent: outcome.result.alreadySent,
            body: outcome.result.message.body,
            status: outcome.result.message.status,
            to: outcome.result.message.customerPhoneE164,
          }
        : { code: outcome.code, message: outcome.message };
    assert.deepEqual(eveOutcomes.map(comparable), appOutcomes.map(comparable));

    // Spot-check that the shared answers are the right ones, not merely equal.
    assert.deepEqual(
      appOutcomes.map((outcome) => (outcome.ok ? (outcome.result.alreadySent ? "replay" : "sent") : outcome.code)),
      ["domain_unauthorized", "domain_transition_unavailable", "sent", "replay", "domain_not_found"],
    );
    assert.equal(
      (appOutcomes[1] as { message: string }).message,
      WHATSAPP_REFUSALS.windowClosed,
    );

    // One provider call each, despite the replay.
    assert.equal(appPort.sends, 1);
    assert.equal(evePort.sends, 1);
    assert.deepEqual(snapshot(eveStore), snapshot(appStore));
    assert.equal(appStore.rows("leadWhatsAppMessage").length, 1);
  });

  test("each adapter keys its own attempts, so an App send and an Eve send are two intents", async () => {
    const port = recordingPort();
    const shared = freshStore();
    const request = { attempt: "same-id", leadId: 1, message: templateMessage, user: staffUser };
    await viaApp(shared, port, request);
    await viaEve(shared, port, request);
    // "same-id" from a browser header and "same-id" as an Eve call id are
    // different intents; the Eve key is namespaced so they cannot collide.
    assert.equal(port.sends, 2);
    assert.equal(shared.rows("leadWhatsAppMessage").length, 2);
  });
});

describe("the real adapters still make this call", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  test("the App route sends through the domain with the header key and the injected port", () => {
    const route = read("app/api/(data)/leads/[leadId]/whatsapp/messages/route.ts");
    assert.match(route, /sendLeadWhatsAppMessage\(/);
    assert.match(route, /headers\.get\("idempotency-key"\)/);
    assert.match(route, /\{ whatsapp: createWhatsAppPortFromEnv\(\) \}/);
    assert.match(route, /domainErrorResponse\(error\)/);
    assert.doesNotMatch(route, /\.leadWhatsApp(Message|Conversation)\./);
  });

  test("the Eve operation sends through the domain with the call-id key and the injected port", () => {
    const operation = read("agent/lib/lead-whatsapp-operations.ts");
    assert.match(operation, /sendLeadWhatsAppMessage\(/);
    assert.match(operation, /idempotencyKey: whatsappIdempotencyKey\(ctx\)/);
    assert.match(operation, /userPrincipal\(actor\)/);
    assert.match(operation, /\{ whatsapp: port \}/);
    assert.match(operation, /whatsappSendEnvelope\(/);
    assert.doesNotMatch(operation, /\.leadWhatsApp(Message|Conversation)\./);
    assert.doesNotMatch(operation, /from "@\/lib\/prisma"/);
  });
});
