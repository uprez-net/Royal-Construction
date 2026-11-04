import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { readWhatsAppConfig } from "@/lib/whatsapp/config";
import {
  handleWhatsAppWebhookDelivery,
  handleWhatsAppWebhookVerification,
  WHATSAPP_WEBHOOK_MAX_BODY_BYTES,
} from "@/lib/whatsapp/webhook-handler";

import { recordingDb } from "../architecture/domain-harness";
import { REPO_ROOT } from "../support/repo-root";

// The public webhook, driven end to end through the real domain commands
// against a recording database. The route itself only supplies prisma and the
// configuration, so this is the behaviour Meta sees.

const SECRET = "app-secret";
const URL_BASE = "https://royal.example/api/whatsapp/webhook";

const config = readWhatsAppConfig({
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_APP_SECRET: SECRET,
  WHATSAPP_BUSINESS_ACCOUNT_ID: "100000000000000",
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PHONE_NUMBERS: "109876543210987=+61280001234=Office",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-me",
});

const quiet = { error: () => {}, info: () => {}, warn: () => {} };
const allowAll = () => true;

function delivery(
  value: Record<string, unknown>,
  accountId = "100000000000000",
) {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "61280001234",
                phone_number_id: "109876543210987",
              },
              ...value,
            },
          },
        ],
        id: accountId,
      },
    ],
    object: "whatsapp_business_account",
  });
}

const TEXT_DELIVERY = delivery({
  contacts: [{ profile: { name: "Sam" }, wa_id: "61412345678" }],
  messages: [
    {
      from: "61412345678",
      id: "wamid.IN",
      text: { body: "Is Saturday OK?" },
      timestamp: "1758528000",
      type: "text",
    },
  ],
});

function post(body: string, signature?: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  const value =
    signature === undefined
      ? `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`
      : signature;
  if (value !== null) headers.set("x-hub-signature-256", value);
  return new Request(URL_BASE, { body, headers, method: "POST" });
}

// ── GET handshake ──────────────────────────────────────────────────────────

test("the subscription handshake echoes the challenge only for the right token", async () => {
  const ok = handleWhatsAppWebhookVerification(
    new Request(
      `${URL_BASE}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444`,
    ),
    config,
  );
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "1158201444");

  for (const query of [
    "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1",
    "hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=1",
    "hub.mode=subscribe&hub.challenge=1",
  ]) {
    const refused = handleWhatsAppWebhookVerification(
      new Request(`${URL_BASE}?${query}`),
      config,
    );
    assert.equal(refused.status, 403, query);
  }
});

test("with WhatsApp off the webhook does not exist", async () => {
  const off = readWhatsAppConfig({ WHATSAPP_ENABLED: "false" });
  assert.equal(
    handleWhatsAppWebhookVerification(
      new Request(
        `${URL_BASE}?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`,
      ),
      off,
    ).status,
    404,
  );
});

// ── POST ────────────────────────────────────────────────────────────────────

test("an unsigned or mis-signed delivery is 401 and touches nothing", async () => {
  for (const signature of [
    null,
    "sha256=deadbeef",
    `sha256=${"0".repeat(64)}`,
  ]) {
    const recorder = recordingDb();
    const response = await handleWhatsAppWebhookDelivery(
      post(TEXT_DELIVERY, signature),
      { allow: allowAll, config, db: recorder.transactionalDb, log: quiet },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(recorder.calls, []);
  }
});

test("a missing app secret fails closed, even for a correctly signed body", async () => {
  const recorder = recordingDb();
  const noSecret = { ...config, appSecret: null };
  const response = await handleWhatsAppWebhookDelivery(post(TEXT_DELIVERY), {
    allow: allowAll,
    config: noSecret,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 401);
  assert.deepEqual(recorder.calls, []);
});

test("an oversized body is refused before it is verified or parsed", async () => {
  const recorder = recordingDb();
  const huge = "x".repeat(WHATSAPP_WEBHOOK_MAX_BODY_BYTES + 1);
  const response = await handleWhatsAppWebhookDelivery(post(huge), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 413);
  assert.deepEqual(recorder.calls, []);
});

test("the rate limit answers 429 before anything else", async () => {
  const recorder = recordingDb();
  const response = await handleWhatsAppWebhookDelivery(post(TEXT_DELIVERY), {
    allow: () => false,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 429);
  assert.deepEqual(recorder.calls, []);
});

test("a delivery for another WhatsApp Business Account is refused, not filed", async () => {
  const recorder = recordingDb();
  const body = delivery({ messages: [] }, "999999999999999");
  const response = await handleWhatsAppWebhookDelivery(post(body), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(recorder.calls, []);
});

test("a verified text from a known lead is filed on that lead before 200", async () => {
  const recorder = recordingDb({
    "lead.findMany": [{ id: 42 }],
    "leadWhatsAppConversation.upsert": {
      id: "conv-1",
      lastInboundAt: null,
      lastMessageAt: null,
    },
    "leadWhatsAppMessage.create": { id: "msg-1" },
    "leadWhatsAppMessage.findUnique": null,
    "whatsAppUnmatchedMessage.findUnique": null,
  });
  const response = await handleWhatsAppWebhookDelivery(post(TEXT_DELIVERY), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 200);
  const lookup = recorder.calls.find(
    (call) => call.operation === "lead.findMany",
  );
  assert.deepEqual((lookup?.args as { where: unknown }).where, {
    phoneE164: "+61412345678",
  });
  const created = recorder.calls.find(
    (call) => call.operation === "leadWhatsAppMessage.create",
  );
  const data = (created?.args as { data: Record<string, unknown> }).data;
  assert.equal(data.leadId, 42);
  assert.equal(data.providerMessageId, "wamid.IN");
  assert.equal(data.direction, "INBOUND");
  assert.equal(data.body, "Is Saturday OK?");
});

test("a replayed delivery is acknowledged and writes nothing", async () => {
  const recorder = recordingDb({
    "leadWhatsAppMessage.findUnique": { id: "msg-1" },
    "whatsAppUnmatchedMessage.findUnique": null,
  });
  const response = await handleWhatsAppWebhookDelivery(post(TEXT_DELIVERY), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(recorder.writes(), []);
});

test("a number two leads share goes to review, not to either lead", async () => {
  const recorder = recordingDb({
    "lead.findMany": [{ id: 1 }, { id: 2 }],
    "leadWhatsAppMessage.findUnique": null,
    "whatsAppUnmatchedMessage.create": { id: "review-1" },
    "whatsAppUnmatchedMessage.findUnique": null,
  });
  const response = await handleWhatsAppWebhookDelivery(post(TEXT_DELIVERY), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["whatsAppUnmatchedMessage.create"],
  );
  const data = (recorder.writes()[0].args as { data: Record<string, unknown> })
    .data;
  assert.equal(data.reason, "AMBIGUOUS");
  assert.deepEqual(data.candidateLeadIds, [1, 2]);
});

test("a status for a known message moves it forward", async () => {
  const recorder = recordingDb({
    "leadWhatsAppMessage.findUnique": {
      deliveredAt: null,
      id: "msg-out",
      readAt: null,
      status: "SENT",
    },
    "whatsAppStatusEvent.create": { id: "event-1" },
    "whatsAppStatusEvent.findUnique": null,
  });
  const body = delivery({
    statuses: [
      {
        id: "wamid.OUT",
        recipient_id: "61412345678",
        status: "delivered",
        timestamp: "1758528010",
      },
    ],
  });
  const response = await handleWhatsAppWebhookDelivery(post(body), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 200);
  const moved = recorder.calls.find(
    (call) => call.operation === "leadWhatsAppMessage.updateMany",
  );
  assert.equal(
    (moved?.args as { data: { status: string } }).data.status,
    "DELIVERED",
  );
});

test("a database failure answers 500 so Meta retries, never 200", async () => {
  const recorder = recordingDb({
    "leadWhatsAppMessage.findUnique": () => {
      throw new Error("connection terminated");
    },
    "whatsAppUnmatchedMessage.findUnique": null,
  });
  const response = await handleWhatsAppWebhookDelivery(post(TEXT_DELIVERY), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 500);
});

test("signed but unparseable is 400: the same bytes will not parse on retry", async () => {
  const recorder = recordingDb();
  const response = await handleWhatsAppWebhookDelivery(post("{not json"), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 400);
});

// ── The route file is only a shell ─────────────────────────────────────────

test("the route delegates to the handler and declares no rejected segment config", () => {
  const source = readFileSync(
    join(REPO_ROOT, "app", "api", "whatsapp", "webhook", "route.ts"),
    "utf8",
  );
  assert.match(source, /handleWhatsAppWebhookDelivery/);
  assert.match(source, /handleWhatsAppWebhookVerification/);
  assert.doesNotMatch(source, /export const (runtime|dynamic)\b/);
  assert.doesNotMatch(source, /JSON\.parse/);
  const proxy = readFileSync(join(REPO_ROOT, "proxy.ts"), "utf8");
  assert.match(proxy, /"\/api\/whatsapp\/webhook\(\.\*\)"/);
});

test("the handler verifies the signature before it parses", () => {
  const source = readFileSync(
    join(REPO_ROOT, "lib", "whatsapp", "webhook-handler.ts"),
    "utf8",
  );
  assert.ok(
    source.indexOf("verifyWhatsAppSignature(request.headers")
      < source.indexOf("JSON.parse(raw)"),
  );
});

// ── Media and groups ───────────────────────────────────────────────────────

const PHOTO_DELIVERY = delivery({
  contacts: [{ profile: { name: "Sam" }, wa_id: "61412345678" }],
  messages: [
    {
      from: "61412345678",
      id: "wamid.PHOTO",
      image: { id: "media-1", mime_type: "image/jpeg" },
      timestamp: "1758528000",
      type: "image",
    },
  ],
});

function photoRecorder() {
  return recordingDb({
    "lead.findMany": [{ id: 42 }],
    "leadWhatsAppConversation.upsert": {
      id: "conv-1",
      lastInboundAt: null,
      lastMessageAt: null,
    },
    "leadWhatsAppMessage.create": { id: "msg-1", media: { id: "media-row-1" } },
    "leadWhatsAppMessage.findUnique": null,
    "whatsAppUnmatchedMessage.findUnique": null,
  });
}

test("a photo is filed with its media, and the copy starts after the write", async () => {
  const recorder = photoRecorder();
  const started: string[][] = [];
  const response = await handleWhatsAppWebhookDelivery(post(PHOTO_DELIVERY), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
    onMediaRecorded: async (ids) => void started.push([...ids]),
  });
  assert.equal(response.status, 200);
  const created = recorder.calls.find(
    (call) => call.operation === "leadWhatsAppMessage.create",
  );
  const data = (created?.args as { data: Record<string, unknown> }).data;
  assert.equal(data.kind, "MEDIA");
  assert.deepEqual(
    (data.media as { create: { providerMediaId: string } }).create
      .providerMediaId,
    "media-1",
  );
  assert.deepEqual(started, [["media-row-1"]]);
});

test("a copy that cannot be started never fails the delivery", async () => {
  const response = await handleWhatsAppWebhookDelivery(post(PHOTO_DELIVERY), {
    allow: allowAll,
    config,
    db: photoRecorder().transactionalDb,
    log: quiet,
    onMediaRecorded: async () => {
      throw new Error("workflow queue down");
    },
  });
  // Recorded as PENDING; the daily sweep starts the copy. Meta must not retry.
  assert.equal(response.status, 200);
});

test("a group message goes to the project that owns the group, not a lead", async () => {
  const recorder = recordingDb({
    "projectWhatsAppGroup.findUnique": {
      id: "grp-row",
      lastMessageAt: null,
      projectId: "p1",
      status: "ACTIVE",
    },
    "projectWhatsAppMessage.create": { id: "pmsg-1", media: null },
    "projectWhatsAppMessage.findUnique": null,
    "whatsAppUnmatchedMessage.findUnique": null,
  });
  const body = delivery({
    contacts: [{ profile: { name: "Ann" }, wa_id: "61412345678" }],
    messages: [
      {
        from: "61412345678",
        group_id: "GROUP-1",
        id: "wamid.GROUP",
        text: { body: "Slab looks great" },
        timestamp: "1758528000",
        type: "text",
      },
    ],
  });
  const response = await handleWhatsAppWebhookDelivery(post(body), {
    allow: allowAll,
    config,
    db: recorder.transactionalDb,
    log: quiet,
  });
  assert.equal(response.status, 200);
  assert.ok(
    !recorder.calls.some((call) => call.operation === "lead.findMany"),
    "a group message is never matched to a lead by phone",
  );
  const created = recorder.calls.find(
    (call) => call.operation === "projectWhatsAppMessage.create",
  );
  const data = (created?.args as { data: Record<string, unknown> }).data;
  assert.equal(data.projectId, "p1");
  assert.equal(data.body, "Slab looks great");
  assert.equal(data.senderName, "Ann");
});
