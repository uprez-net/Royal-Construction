import assert from "node:assert/strict";

import { describe, test } from "vitest";

import { readWhatsAppBridgeConfig } from "@/lib/whatsapp-bridge/config";
import { handleWhatsAppBridgeWebhook } from "@/lib/whatsapp-bridge/webhook-handler";
import {
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_TIMESTAMP_HEADER,
  signBridgeBody,
  verifyBridgeSignature,
} from "@/lib/whatsapp-bridge/webhook-signature";

import { fakeWhatsAppDb } from "../architecture/whatsapp-fake-db";

// The public endpoint the bridge posts to. On the open internet and writing
// onto a client's project, so: nothing unsigned, nothing stale, nothing twice,
// and the answers the bridge's outbox acts on (200 done, 400 never, 401/5xx
// retry) pinned exactly.

const SECRET = "s".repeat(64);
const GROUP = "120363000000000001@g.us";
const NOW = Date.parse("2026-11-21T01:00:00Z");

const config = readWhatsAppBridgeConfig({
  WHATSAPP_BRIDGE_API_TOKEN: "t".repeat(64),
  WHATSAPP_BRIDGE_URL: "https://bridge.example",
  WHATSAPP_BRIDGE_WEBHOOK_SECRET: SECRET,
});

const quiet = { error: () => {}, info: () => {}, warn: () => {} };

function signed(
  event: unknown,
  options: { secret?: string; at?: number } = {},
) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor((options.at ?? NOW) / 1000);
  return new Request("https://app.example/api/whatsapp-bridge/webhook", {
    body,
    headers: {
      "content-type": "application/json",
      [BRIDGE_SIGNATURE_HEADER]: signBridgeBody(
        options.secret ?? SECRET,
        timestamp,
        body,
      ),
      [BRIDGE_TIMESTAMP_HEADER]: String(timestamp),
    },
    method: "POST",
  });
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      fromMe: false,
      groupJid: GROUP,
      kind: "text",
      media: null,
      messageId: "3EB0IN1",
      projectId: "p1",
      sender: {
        jid: "123456789012345@lid",
        name: "Ann",
        phoneE164: "+61412345678",
      },
      sentAt: "2026-11-21T00:59:00.000Z",
      text: "Slab looks great",
      unsupportedType: null,
      ...overrides,
    },
    id: "msg:3EB0IN1",
    occurredAt: "2026-11-21T00:59:01.000Z",
    type: "message.received",
  };
}

function seeded() {
  const fake = fakeWhatsAppDb();
  fake.seed("project", {
    id: "p1",
    leadId: 1,
    location: "12 Smith St",
    name: "Lee",
  });
  fake.seed("projectWhatsAppGroup", {
    origin: "CREATED",
    projectId: "p1",
    providerGroupId: GROUP,
    status: "ACTIVE",
    subject: "Royal Constructions · 12 Smith St",
  });
  return fake;
}

function deps(fake = seeded(), extra: Record<string, unknown> = {}) {
  return {
    allow: () => true,
    config,
    db: fake.transactionalDb,
    log: quiet,
    now: () => NOW,
    ...extra,
  };
}

describe("signature", () => {
  test("signed over the timestamp and the raw body; stale or tampered is refused", () => {
    const body = '{"a":1}';
    const at = Math.floor(NOW / 1000);
    const headers = (signature: string, timestamp = at) =>
      new Headers({
        [BRIDGE_SIGNATURE_HEADER]: signature,
        [BRIDGE_TIMESTAMP_HEADER]: String(timestamp),
      });
    const good = signBridgeBody(SECRET, at, body);
    assert.equal(verifyBridgeSignature(headers(good), body, SECRET, NOW), true);
    assert.equal(
      verifyBridgeSignature(headers(good), '{"a":2}', SECRET, NOW),
      false,
    );
    assert.equal(
      verifyBridgeSignature(headers(good, at + 1), body, SECRET, NOW),
      false,
    );
    assert.equal(
      verifyBridgeSignature(headers(good), body, SECRET, NOW + 6 * 60 * 1000),
      false,
      "older than five minutes",
    );
    assert.equal(verifyBridgeSignature(headers(good), body, null, NOW), false);
    assert.equal(
      verifyBridgeSignature(headers("sha256=zz"), body, SECRET, NOW),
      false,
    );
  });
});

describe("the webhook", () => {
  test("unsigned, mis-signed or with no secret configured is a 401, and nothing is written", async () => {
    const fake = seeded();
    const before = fake.log.length;
    const wrong = await handleWhatsAppBridgeWebhook(
      signed(message(), { secret: "x".repeat(64) }),
      deps(fake),
    );
    assert.equal(wrong.status, 401);
    const noSecret = await handleWhatsAppBridgeWebhook(signed(message()), {
      ...deps(fake),
      config: { ...config, webhookSecret: null },
    });
    assert.equal(noSecret.status, 401, "kept by the bridge, not dropped");
    assert.equal(fake.log.length, before);
  });

  test("a message for a linked group is recorded once; a redelivery is a duplicate", async () => {
    const fake = seeded();
    const first = await handleWhatsAppBridgeWebhook(
      signed(message()),
      deps(fake),
    );
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { outcome: "attached" });
    const again = await handleWhatsAppBridgeWebhook(
      signed(message()),
      deps(fake),
    );
    assert.deepEqual(await again.json(), { outcome: "duplicate" });
    assert.equal(fake.rows("projectWhatsAppMessage").length, 1);
  });

  test("a message for a group no project has is acknowledged, not retried, and not filed", async () => {
    const fake = seeded();
    const warnings: string[] = [];
    const response = await handleWhatsAppBridgeWebhook(
      signed(message({ groupJid: "120363000000000009@g.us" })),
      deps(fake, {
        log: { ...quiet, warn: (line: string) => warnings.push(line) },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { outcome: "unknown_group" });
    assert.equal(fake.rows("projectWhatsAppMessage").length, 0);
    assert.match(warnings.join(" "), /Resync/);
  });

  test("a file starts the copy workflow once the message is committed", async () => {
    const started: string[][] = [];
    const response = await handleWhatsAppBridgeWebhook(
      signed(
        message({
          kind: "media",
          media: {
            available: true,
            byteSize: 3,
            caption: "Frame",
            fileName: null,
            kind: "image",
            mimeType: "image/jpeg",
            sha256: null,
            unavailableReason: null,
            voice: false,
          },
          text: "Frame",
        }),
      ),
      deps(seeded(), {
        onMediaRecorded: async (ids: readonly string[]) =>
          void started.push([...ids]),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(started.length, 1);
  });

  test("a malformed event is a 400 the bridge sets aside; an unknown type is accepted", async () => {
    const bad = await handleWhatsAppBridgeWebhook(
      signed({ ...message(), data: { groupJid: "nope" } }),
      deps(),
    );
    assert.equal(bad.status, 400);
    const newer = await handleWhatsAppBridgeWebhook(
      signed({
        data: {},
        id: "x",
        occurredAt: "2026-11-21T00:00:00.000Z",
        type: "poll.created",
      }),
      deps(),
    );
    assert.equal(newer.status, 200);
    assert.deepEqual(await newer.json(), { outcome: "ignored" });
  });

  test("a logged-out bridge is reported as an error, because nobody watches logs", async () => {
    const errors: string[] = [];
    const response = await handleWhatsAppBridgeWebhook(
      signed({
        data: {
          account: null,
          reason: "WhatsApp unlinked this device.",
          status: "logged_out",
        },
        id: "s1",
        occurredAt: "2026-11-21T00:00:00.000Z",
        type: "session.updated",
      }),
      deps(seeded(), {
        log: { ...quiet, error: (line: string) => errors.push(line) },
      }),
    );
    assert.equal(response.status, 200);
    assert.match(errors.join(" "), /logged out/);
  });

  test("a database failure answers 500 so the bridge keeps the event", async () => {
    const fake = seeded();
    const broken = new Proxy(fake.transactionalDb, {
      get: (target, key) =>
        key === "$transaction"
          ? async () => {
              throw new Error("database unavailable");
            }
          : Reflect.get(target, key),
    });
    const response = await handleWhatsAppBridgeWebhook(signed(message()), {
      ...deps(fake),
      db: broken,
    });
    assert.equal(response.status, 500);
  });
});
