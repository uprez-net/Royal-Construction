import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isWhatsAppSendError,
  type WhatsAppSendError,
} from "@/lib/domain/ports/whatsapp";
import { createCloudApiWhatsAppPort } from "@/lib/whatsapp/cloud-api";
import { readWhatsAppConfig } from "@/lib/whatsapp/config";

// The one judgement the adapter makes: "nothing was sent" (safe to retry) or
// "it might have been" (hold for a person). Meta has no idempotency key for
// sends, so getting this wrong in the permissive direction is how a customer
// receives the same message twice.

const TOKEN = "EAA-test-token-do-not-log";

const config = readWhatsAppConfig({
  WHATSAPP_ACCESS_TOKEN: TOKEN,
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PHONE_NUMBERS: "109876543210987=+61280001234=Office",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify",
});

const TEXT = {
  body: "Hello",
  fromPhoneNumberId: "109876543210987",
  to: "+61412345678",
};

type Call = { url: string; init: RequestInit };

function portWith(respond: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call = { init: init ?? {}, url: String(url) };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  const port = createCloudApiWhatsAppPort(config, fetchImpl);
  assert.ok(port);
  return { calls, port };
}

async function failure(promise: Promise<unknown>): Promise<WhatsAppSendError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(isWhatsAppSendError(error), "expected a WhatsAppSendError");
    assert.doesNotMatch(error.message, new RegExp(TOKEN));
    return error;
  }
  assert.fail("expected the send to fail");
}

test("200 with a message id is a receipt, sent from the chosen number", async () => {
  const { calls, port } = portWith(() =>
    Response.json({ messages: [{ id: "wamid.OK" }] }),
  );
  assert.deepEqual(await port.sendText(TEXT), {
    providerMessageId: "wamid.OK",
  });
  assert.match(calls[0].url, /\/v\d+\.\d+\/109876543210987\/messages$/);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.to, "+61412345678");
  assert.deepEqual(body.text, { body: "Hello", preview_url: false });
  assert.equal(
    (calls[0].init.headers as Record<string, string>).Authorization,
    `Bearer ${TOKEN}`,
  );
});

test("a template goes out with its name, language and body parameters in order", async () => {
  const { calls, port } = portWith(() =>
    Response.json({ messages: [{ id: "wamid.T" }] }),
  );
  await port.sendTemplate({
    bodyParameters: ["Sam", "your new home"],
    fromPhoneNumberId: "109876543210987",
    language: "en",
    templateName: "lead_enquiry_follow_up",
    to: "+61412345678",
  });
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.type, "template");
  assert.deepEqual(body.template, {
    components: [
      {
        parameters: [
          { text: "Sam", type: "text" },
          { text: "your new home", type: "text" },
        ],
        type: "body",
      },
    ],
    language: { code: "en" },
    name: "lead_enquiry_follow_up",
  });
});

test("a 4xx refusal is not_sent, in words an operator can act on", async () => {
  const { port } = portWith(() =>
    Response.json(
      {
        error: {
          code: 131047,
          fbtrace_id: "trace",
          message: "Re-engagement message",
          title: "Re-engagement message",
        },
      },
      { status: 400 },
    ),
  );
  const error = await failure(port.sendText(TEXT));
  assert.equal(error.outcome, "not_sent");
  assert.equal(error.details.code, "131047");
  assert.match(error.message, /24 hours/);
});

test("an expired token is not_sent and says who has to fix it", async () => {
  const { port } = portWith(() =>
    Response.json(
      { error: { code: 190, message: "Invalid OAuth access token" } },
      { status: 401 },
    ),
  );
  const error = await failure(port.sendText(TEXT));
  assert.equal(error.outcome, "not_sent");
  assert.match(error.message, /WHATSAPP_ACCESS_TOKEN/);
});

test("a 5xx is ambiguous: Meta may have queued it", async () => {
  const { port } = portWith(() =>
    Response.json({ error: { code: 131000 } }, { status: 500 }),
  );
  assert.equal((await failure(port.sendText(TEXT))).outcome, "ambiguous");
});

test("200 without a message id is ambiguous, not success", async () => {
  const { port } = portWith(() => Response.json({ messages: [] }));
  assert.equal((await failure(port.sendText(TEXT))).outcome, "ambiguous");
});

test("a timeout is ambiguous", async () => {
  const { port } = portWith(() => {
    throw new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
  });
  assert.equal((await failure(port.sendText(TEXT))).outcome, "ambiguous");
});

test("a reset connection after the request left is ambiguous", async () => {
  const { port } = portWith(() => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
  });
  assert.equal((await failure(port.sendText(TEXT))).outcome, "ambiguous");
});

test("a refused connection never reached Meta: not_sent and unreachable", async () => {
  const { port } = portWith(() => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  });
  const error = await failure(port.sendText(TEXT));
  assert.equal(error.outcome, "not_sent");
  assert.equal(error.details.unreachable, true);
});

test("no port is built while WhatsApp is off", () => {
  assert.equal(
    createCloudApiWhatsAppPort(
      readWhatsAppConfig({ WHATSAPP_ENABLED: "false" }),
    ),
    null,
  );
});
