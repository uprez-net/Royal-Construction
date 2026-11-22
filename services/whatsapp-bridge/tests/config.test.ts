import assert from "node:assert/strict";

import { describe, test } from "vitest";

import { readConfig } from "../src/config.js";

const TOKEN = "t".repeat(64);
const SECRET = "s".repeat(64);

describe("configuration", () => {
  test("refuses to start without a strong API token", () => {
    assert.throws(() => readConfig({}), /BRIDGE_API_TOKEN/);
    assert.throws(
      () => readConfig({ BRIDGE_API_TOKEN: "short" }),
      /BRIDGE_API_TOKEN/,
    );
  });

  test("events go over https, or plain http only to this machine", () => {
    for (const url of [
      "https://app.example/api/whatsapp-bridge/webhook",
      "http://localhost:3000/api/whatsapp-bridge/webhook",
      "http://127.0.0.1:3000/api/whatsapp-bridge/webhook",
      "http://host.docker.internal:3000/api/whatsapp-bridge/webhook",
    ]) {
      const config = readConfig({
        APP_WEBHOOK_URL: url,
        BRIDGE_API_TOKEN: TOKEN,
        BRIDGE_WEBHOOK_SECRET: SECRET,
      });
      assert.equal(config.appWebhookUrl, url);
    }
    assert.throws(
      () =>
        readConfig({
          APP_WEBHOOK_URL: "http://app.example/api/whatsapp-bridge/webhook",
          BRIDGE_API_TOKEN: TOKEN,
          BRIDGE_WEBHOOK_SECRET: SECRET,
        }),
      /must be https/,
    );
  });

  test("a webhook URL without a signing secret is refused", () => {
    assert.throws(
      () =>
        readConfig({
          APP_WEBHOOK_URL: "https://app.example/x",
          BRIDGE_API_TOKEN: TOKEN,
        }),
      /BRIDGE_WEBHOOK_SECRET is required/,
    );
  });

  test("defaults for a local run", () => {
    const config = readConfig({ BRIDGE_API_TOKEN: TOKEN });
    assert.equal(config.port, 8080);
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.appWebhookUrl, null);
    assert.equal(config.mediaRetentionDays, 14);
  });
});
