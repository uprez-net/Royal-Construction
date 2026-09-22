import assert from "node:assert/strict";
import { test } from "vitest";

import {
  DEFAULT_WHATSAPP_GRAPH_API_VERSION,
  parseWhatsAppPhoneNumbers,
  readWhatsAppConfig,
} from "@/lib/whatsapp/config";

const FULL = {
  WHATSAPP_ACCESS_TOKEN: "token",
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PHONE_NUMBERS:
    "109876543210987=+61280001234=Office, 209876543210987=+61412345678=Sales",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
};

test("phone numbers parse as id=E.164=label, comma-separated", () => {
  const { numbers, problems } = parseWhatsAppPhoneNumbers(
    FULL.WHATSAPP_PHONE_NUMBERS,
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(numbers, [
    {
      displayNumber: "+61280001234",
      label: "Office",
      phoneNumberId: "109876543210987",
    },
    {
      displayNumber: "+61412345678",
      label: "Sales",
      phoneNumberId: "209876543210987",
    },
  ]);
});

test("a malformed or duplicate entry is dropped and reported, not half-used", () => {
  const { numbers, problems } = parseWhatsAppPhoneNumbers(
    "abc=+61280001234=Bad id,109876543210987=0400=Bad number,109876543210987=+61280001234=Office,109876543210987=+61280001234=Again",
  );
  assert.deepEqual(
    numbers.map((number) => number.label),
    ["Office"],
  );
  assert.equal(problems.length, 3);
});

test("anything but the exact string true leaves WhatsApp off", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", "yes"]) {
    const config = readWhatsAppConfig({ ...FULL, WHATSAPP_ENABLED: flag });
    assert.equal(config.enabled, false, String(flag));
    assert.equal(config.channel, null);
    // Secrets are not even surfaced while the channel is off.
    assert.equal(config.accessToken, null);
    assert.equal(config.appSecret, null);
  }
});

test("the default sender is the configured id, or the first number when it is unknown", () => {
  assert.equal(
    readWhatsAppConfig({
      ...FULL,
      WHATSAPP_DEFAULT_PHONE_NUMBER_ID: "209876543210987",
    }).channel?.defaultPhoneNumberId,
    "209876543210987",
  );
  const unknown = readWhatsAppConfig({
    ...FULL,
    WHATSAPP_DEFAULT_PHONE_NUMBER_ID: "999",
  });
  assert.equal(unknown.channel?.defaultPhoneNumberId, "109876543210987");
  assert.ok(
    unknown.problems.some((problem) =>
      problem.includes("WHATSAPP_DEFAULT_PHONE_NUMBER_ID"),
    ),
  );
});

test("no token: the channel is readable but sending is unavailable", () => {
  const config = readWhatsAppConfig({ ...FULL, WHATSAPP_ACCESS_TOKEN: "" });
  assert.equal(config.channel?.sendingAvailable, false);
  assert.ok(
    config.problems.some((problem) =>
      problem.includes("WHATSAPP_ACCESS_TOKEN"),
    ),
  );
});

test("enabled with no usable number has no channel", () => {
  const config = readWhatsAppConfig({ ...FULL, WHATSAPP_PHONE_NUMBERS: "" });
  assert.equal(config.enabled, true);
  assert.equal(config.channel, null);
});

test("templates narrow per deployment, and the API version defaults", () => {
  const config = readWhatsAppConfig({
    ...FULL,
    WHATSAPP_ENABLED_TEMPLATES: " lead_missed_contact , ",
  });
  assert.deepEqual(config.channel?.enabledTemplateNames, [
    "lead_missed_contact",
  ]);
  assert.equal(config.apiVersion, DEFAULT_WHATSAPP_GRAPH_API_VERSION);
  assert.equal(readWhatsAppConfig(FULL).channel?.enabledTemplateNames, null);
});

test("problems never quote a secret", () => {
  const config = readWhatsAppConfig({
    ...FULL,
    WHATSAPP_ACCESS_TOKEN: "EAA-super-secret",
    WHATSAPP_APP_SECRET: "app-secret-value",
    WHATSAPP_PHONE_NUMBERS: "bad",
  });
  assert.doesNotMatch(
    config.problems.join("\n"),
    /EAA-super-secret|app-secret-value/,
  );
});
