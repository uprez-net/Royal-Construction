import assert from "node:assert/strict";
import { test } from "vitest";

import {
  commsChannel,
  parseCommsPhoneNumbers,
  readCommsConfig,
} from "@/lib/comms/config";
import { commsAdapter, providerFromPath } from "@/lib/comms/factory";

// The provider switch (file 06 §4–5): unset means Twilio, an unknown value
// fails loudly, numbers name their own carrier, and availability follows the
// active provider's credentials — never another provider's.

const BASE = {
  COMMS_CALLS_ENABLED: "true",
  COMMS_PHONE_NUMBERS: "+61280001234=twilio=Office,+61290001234=telnyx=Office",
  COMMS_SMS_ENABLED: "true",
  COMMS_WEBHOOK_ORIGIN: "https://royal.example",
  TELNYX_API_KEY: "KEY",
  TELNYX_CONNECTION_ID: "conn",
  TELNYX_PUBLIC_KEY: Buffer.alloc(32, 1).toString("base64"),
  TELNYX_WEBRTC_CONNECTION_ID: "webrtc",
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_API_KEY_SECRET: "secret",
  TWILIO_API_KEY_SID: "SK00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "token",
};

test("an unset provider means Twilio, so an existing deployment does not change", () => {
  const config = readCommsConfig(BASE);
  assert.equal(config.provider, "twilio");
  assert.equal(commsChannel(config)?.defaultNumber?.e164, "+61280001234");
});

test("COMMUNICATIONS_PROVIDER picks the sender, and the legacy alias still works", () => {
  assert.equal(
    readCommsConfig({ ...BASE, COMMUNICATIONS_PROVIDER: "telnyx" }).provider,
    "telnyx",
  );
  assert.equal(
    readCommsConfig({ ...BASE, COMMS_PROVIDER: "TELNYX" }).provider,
    "telnyx",
  );
  const channel = commsChannel(
    readCommsConfig({ ...BASE, COMMUNICATIONS_PROVIDER: "telnyx" }),
  );
  assert.equal(channel?.defaultNumber?.e164, "+61290001234");
});

test("an unknown provider fails loudly instead of falling back", () => {
  const config = readCommsConfig({ ...BASE, COMMUNICATIONS_PROVIDER: "plivo" });
  assert.equal(config.provider, null);
  assert.equal(commsChannel(config), null);
  assert.ok(
    config.problems.some((problem) =>
      problem.includes("COMMUNICATIONS_PROVIDER"),
    ),
  );
});

test("a malformed number is dropped and reported, never half-used", () => {
  const parsed = parseCommsPhoneNumbers(
    "+61280001234=twilio=Office,12=twilio=Bad,+61290001234=vonage=X",
  );
  assert.deepEqual(
    parsed.numbers.map((n) => n.e164),
    ["+61280001234"],
  );
  assert.equal(parsed.problems.length, 2);
});

test("availability follows the active provider's own credentials", () => {
  const noTelnyx = readCommsConfig({
    ...BASE,
    COMMUNICATIONS_PROVIDER: "telnyx",
    TELNYX_API_KEY: "",
  });
  const channel = commsChannel(noTelnyx);
  assert.equal(channel?.smsAvailable, false);
  assert.equal(channel?.callsAvailable, false);
  // Twilio's credentials being present does not make Telnyx available.
  assert.equal(commsChannel(readCommsConfig(BASE))?.smsAvailable, true);
});

test("both flags off means the channel is off", () => {
  assert.equal(
    commsChannel(
      readCommsConfig({
        ...BASE,
        COMMS_CALLS_ENABLED: "",
        COMMS_SMS_ENABLED: "",
      }),
    ),
    null,
  );
});

test("webhooks route by the provider in the path; anything else is unknown", () => {
  assert.equal(providerFromPath("twilio"), "twilio");
  assert.equal(providerFromPath("telnyx"), "telnyx");
  assert.equal(providerFromPath("plivo"), null);
  assert.equal(providerFromPath("../twilio"), null);
});

test("every adapter answers the same contract", () => {
  const config = readCommsConfig(BASE);
  for (const name of ["twilio", "telnyx"] as const) {
    const adapter = commsAdapter(name, config);
    assert.equal(adapter.name, name);
    assert.ok(adapter.sms, `${name} sends SMS`);
    assert.ok(adapter.voice, `${name} places calls`);
    assert.ok(adapter.recordings, `${name} fetches recordings`);
    assert.ok(
      adapter.issueBrowserCredential,
      `${name} issues browser credentials`,
    );
    for (const key of [
      "sms",
      "outboundCalls",
      "browserCalling",
      "browserSdkBundled",
      "voiceAgent",
      "callControl",
      "inboundCallFlow",
      "recordings",
    ]) {
      assert.ok(key in adapter.capabilities, `${name} declares ${key}`);
    }
    assert.equal(typeof adapter.updateLiveCall, "function");
  }
});

const MILI = {
  COMMS_AGENT_ENABLED: "true",
  COMMS_AGENT_SECRET: "s".repeat(32),
};

test("Mili answers on either carrier once she is switched on", () => {
  for (const provider of ["twilio", "telnyx"] as const) {
    const config = readCommsConfig({
      ...BASE,
      ...MILI,
      COMMUNICATIONS_PROVIDER: provider,
    });
    assert.equal(commsChannel(config)?.voiceAgent, true, provider);
    assert.equal(commsAdapter(provider, config).capabilities.voiceAgent, true);
    assert.deepEqual(config.problems, []);
  }
  assert.equal(commsChannel(readCommsConfig(BASE))?.voiceAgent, false);
});

test("Mili stays off without a strong secret, and says why", () => {
  for (const secret of ["", "too-short"]) {
    const config = readCommsConfig({
      ...BASE,
      ...MILI,
      COMMS_AGENT_SECRET: secret,
    });
    assert.equal(commsChannel(config)?.voiceAgent, false, secret);
    assert.ok(
      config.problems.some((problem) => problem.includes("Mili is off")),
      secret,
    );
  }
  // Calls switched off: Mili is off too, quietly.
  assert.equal(
    commsChannel(readCommsConfig({ ...BASE, ...MILI, COMMS_CALLS_ENABLED: "" }))
      ?.voiceAgent,
    false,
  );
});
