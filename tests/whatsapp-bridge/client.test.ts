import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  WhatsAppMediaError,
  WhatsAppSendError,
} from "@/lib/domain/ports/whatsapp";
import { WhatsAppBridgeError } from "@/lib/domain/ports/whatsapp-bridge";
import { createWhatsAppBridgePort } from "@/lib/whatsapp-bridge/client";
import { readWhatsAppBridgeConfig } from "@/lib/whatsapp-bridge/config";

// The app's adapter over the bridge's HTTP API. The judgement it owns — did a
// failed send possibly reach the group — is pinned here, along with the token
// travelling on every call and never anywhere else.

const TOKEN = "a".repeat(64);
const SECRET = "b".repeat(64);
const GROUP = "120363000000000001@g.us";

const config = readWhatsAppBridgeConfig({
  WHATSAPP_BRIDGE_API_TOKEN: TOKEN,
  WHATSAPP_BRIDGE_URL: "https://bridge.example/",
  WHATSAPP_BRIDGE_WEBHOOK_SECRET: SECRET,
});

type Seen = { url: string; init: RequestInit };

function port(answer: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call = { init: init ?? {}, url: String(url) };
    seen.push(call);
    return answer(call);
  }) as typeof fetch;
  const bridge = createWhatsAppBridgePort(config, fetchImpl);
  assert.ok(bridge);
  return { bridge, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });

const refusal = (status: number, code: string, message = "Refused.") =>
  json({ error: { code, message } }, status);

describe("configuration", () => {
  test("on only with an https URL and a token; problems are named, secrets never", () => {
    assert.equal(config.enabled, true);
    assert.equal(config.url, "https://bridge.example");
    const insecure = readWhatsAppBridgeConfig({
      WHATSAPP_BRIDGE_API_TOKEN: TOKEN,
      WHATSAPP_BRIDGE_URL: "http://bridge.example",
    });
    assert.equal(insecure.enabled, false);
    assert.match(insecure.problems.join(" "), /must be https/);
    assert.ok(!insecure.problems.join(" ").includes(TOKEN));
    const noSecret = readWhatsAppBridgeConfig({
      WHATSAPP_BRIDGE_API_TOKEN: TOKEN,
      WHATSAPP_BRIDGE_URL: "https://bridge.example",
    });
    assert.match(noSecret.problems.join(" "), /WEBHOOK_SECRET is not set/);
    assert.equal(readWhatsAppBridgeConfig({}).enabled, false);
    assert.equal(createWhatsAppBridgePort(readWhatsAppBridgeConfig({})), null);
  });
});

describe("calls", () => {
  test("every call carries the bearer token", async () => {
    const { bridge, seen } = port(() =>
      json({
        groups: [
          { jid: GROUP, participants: [], projectId: "p1", subject: "S" },
        ],
      }),
    );
    const groups = await bridge.listGroups();
    assert.equal(groups[0].mappedProjectId, "p1");
    assert.equal(seen[0].url, "https://bridge.example/v1/groups");
    assert.equal(
      (seen[0].init.headers as Record<string, string>).Authorization,
      `Bearer ${TOKEN}`,
    );
  });

  test("a send carries the Idempotency-Key and returns the message id", async () => {
    const { bridge, seen } = port(() =>
      json({
        messageId: "3EB0A",
        replayed: true,
        sentAt: "2026-11-21T00:00:00.000Z",
      }),
    );
    const receipt = await bridge.sendText({
      groupJid: GROUP,
      idempotencyKey: "project-whatsapp:p1:k1",
      text: "Hi",
    });
    assert.deepEqual(receipt, {
      messageId: "3EB0A",
      replayed: true,
      sentAt: new Date("2026-11-21T00:00:00.000Z"),
    });
    assert.match(
      seen[0].url,
      /\/v1\/groups\/120363000000000001%40g\.us\/messages$/,
    );
    assert.equal(
      (seen[0].init.headers as Record<string, string>)["Idempotency-Key"],
      "project-whatsapp:p1:k1",
    );
  });

  test("a refused send is not_sent; an unconfirmed or unanswered one is ambiguous", async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => refusal(503, "not_connected"), "not_sent"],
      [() => refusal(502, "whatsapp_refused"), "not_sent"],
      // Another request holds the key and may still reach the group.
      [() => refusal(409, "send_in_progress"), "ambiguous"],
      [() => refusal(409, "key_conflict"), "not_sent"],
      [() => refusal(504, "send_unconfirmed"), "ambiguous"],
      [() => refusal(500, "internal"), "ambiguous"],
      [
        () => {
          throw new TypeError("fetch failed");
        },
        "ambiguous",
      ],
    ];
    for (const [answer, outcome] of cases) {
      const { bridge } = port(answer);
      await assert.rejects(
        bridge.sendText({ groupJid: GROUP, idempotencyKey: "k", text: "Hi" }),
        (error: unknown) =>
          error instanceof WhatsAppSendError && error.outcome === outcome,
      );
    }
  });

  test("the bridge's sentence reaches the office; a wrong token is named as such", async () => {
    const { bridge } = port(() =>
      refusal(503, "not_connected", "The WhatsApp bridge isn't connected."),
    );
    await assert.rejects(bridge.listGroups(), (error: unknown) => {
      assert.ok(error instanceof WhatsAppBridgeError);
      assert.equal(error.code, "not_connected");
      assert.equal(error.message, "The WhatsApp bridge isn't connected.");
      return true;
    });
    const wrong = port(() => refusal(401, "unauthorized"));
    await assert.rejects(wrong.bridge.session(), /API_TOKEN doesn't match/);
  });

  test("no QR is null, not an error", async () => {
    const { bridge } = port(() => refusal(404, "no_qr"));
    assert.equal(await bridge.qr(), null);
  });
});

describe("groups and mappings", () => {
  test("a create answered without the group's id is unconfirmed, never a group with no id", async () => {
    for (const answer of [
      () => json({ inviteLink: null }, 201),
      () => json({ group: { jid: "" } }, 201),
      () => new Response("not json", { status: 201 }),
    ]) {
      const { bridge } = port(answer);
      await assert.rejects(
        bridge.createGroup({
          description: null,
          participantsE164: [],
          projectId: "p1",
          subject: "S",
        }),
        (error: unknown) =>
          error instanceof WhatsAppSendError && error.outcome === "ambiguous",
      );
    }
  });

  test("unmapping names the project, so a newer link elsewhere survives", async () => {
    const { bridge, seen } = port(() =>
      json({ mappedTo: null, removed: true }),
    );
    await bridge.removeMapping(GROUP, "p1");
    await bridge.removeMapping(GROUP);
    assert.match(seen[0].url, /\?projectId=p1$/);
    assert.doesNotMatch(seen[1].url, /\?/);
  });

  test("events can be received only with the webhook secret", () => {
    assert.equal(createWhatsAppBridgePort(config)?.receivesEvents, true);
    const noSecret = createWhatsAppBridgePort(
      readWhatsAppBridgeConfig({
        WHATSAPP_BRIDGE_API_TOKEN: TOKEN,
        WHATSAPP_BRIDGE_URL: "https://bridge.example",
      }),
    );
    assert.equal(noSecret?.receivesEvents, false);
  });
});

describe("media", () => {
  test("a file served as JSON is returned as a file, not parsed", async () => {
    const { bridge } = port(
      () =>
        new Response('{"a":1}', {
          headers: {
            "content-length": "7",
            "content-type": "application/json",
          },
        }),
    );
    const file = await bridge.downloadMedia("3EB0JSON", { maxBytes: 1000 });
    assert.equal(new TextDecoder().decode(file.bytes), '{"a":1}');
  });

  test("a file the bridge no longer has is permanent; a timeout is not", async () => {
    const gone = port(() => refusal(404, "not_found"));
    await assert.rejects(
      gone.bridge.downloadMedia("3EB0X", { maxBytes: 1000 }),
      (error: unknown) =>
        error instanceof WhatsAppMediaError && error.permanent === true,
    );
    const down = port(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      down.bridge.downloadMedia("3EB0X", { maxBytes: 1000 }),
      (error: unknown) =>
        error instanceof WhatsAppMediaError && error.permanent === false,
    );
  });

  test("returns the bytes and type; refuses one over the limit", async () => {
    const ok = port(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-length": "3", "content-type": "image/jpeg" },
        }),
    );
    const file = await ok.bridge.downloadMedia("3EB0X", { maxBytes: 1000 });
    assert.deepEqual([...file.bytes], [1, 2, 3]);
    assert.equal(file.mimeType, "image/jpeg");
    const big = port(
      () =>
        new Response(new Uint8Array(10), {
          headers: { "content-length": "10", "content-type": "video/mp4" },
        }),
    );
    await assert.rejects(
      big.bridge.downloadMedia("3EB0X", { maxBytes: 5 }),
      (error: unknown) =>
        error instanceof WhatsAppMediaError && error.permanent === true,
    );
  });
});
