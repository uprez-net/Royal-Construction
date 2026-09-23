import assert from "node:assert/strict";
import { test } from "vitest";

import { parseWhatsAppWebhook } from "@/lib/whatsapp/webhook-payload";

// Shapes follow Meta's published payload examples (Cloud API webhooks →
// payload examples): one entry per WABA, one change per field, `value` carrying
// metadata, contacts, messages and statuses. Timestamps are Unix seconds as
// strings.

function delivery(value: Record<string, unknown>, field = "messages") {
  return {
    entry: [
      {
        changes: [
          {
            field,
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
        id: "100000000000000",
      },
    ],
    object: "whatsapp_business_account",
  };
}

const CONTACTS = [{ profile: { name: "Sam Customer" }, wa_id: "61412345678" }];

test("an inbound text becomes one inbound message with the profile name", () => {
  const parsed = parseWhatsAppWebhook(
    delivery({
      contacts: CONTACTS,
      messages: [
        {
          from: "61412345678",
          id: "wamid.TEXT",
          text: { body: "Hi, is Saturday OK?" },
          timestamp: "1758528000",
          type: "text",
        },
      ],
    }),
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.businessAccountIds, ["100000000000000"]);
  assert.deepEqual(parsed.messages, [
    {
      businessPhoneNumberId: "109876543210987",
      fromWaId: "61412345678",
      profileName: "Sam Customer",
      providerMessageId: "wamid.TEXT",
      sentAt: new Date(1758528000 * 1000),
      text: "Hi, is Saturday OK?",
      type: "text",
    },
  ]);
  assert.deepEqual(parsed.statuses, []);
});

test("a quick-reply button and an interactive reply carry their label as text", () => {
  const parsed = parseWhatsAppWebhook(
    delivery({
      contacts: CONTACTS,
      messages: [
        {
          button: { payload: "YES", text: "Yes please" },
          from: "61412345678",
          id: "wamid.BUTTON",
          timestamp: "1758528000",
          type: "button",
        },
        {
          from: "61412345678",
          id: "wamid.INTERACTIVE",
          interactive: {
            button_reply: { id: "b1", title: "Call me" },
            type: "button_reply",
          },
          timestamp: "1758528001",
          type: "interactive",
        },
        {
          from: "61412345678",
          id: "wamid.LIST",
          interactive: {
            list_reply: { id: "l1", title: "Next week" },
            type: "list_reply",
          },
          timestamp: "1758528002",
          type: "interactive",
        },
      ],
    }),
  );
  assert.deepEqual(
    parsed?.messages.map((message) => message.text),
    ["Yes please", "Call me", "Next week"],
  );
});

test("an image is kept as an unsupported message with no text, not dropped", () => {
  const parsed = parseWhatsAppWebhook(
    delivery({
      contacts: CONTACTS,
      messages: [
        {
          from: "61412345678",
          id: "wamid.IMAGE",
          image: { id: "media-1", mime_type: "image/jpeg" },
          timestamp: "1758528000",
          type: "image",
        },
      ],
    }),
  );
  assert.equal(parsed?.messages.length, 1);
  assert.equal(parsed?.messages[0].type, "image");
  assert.equal(parsed?.messages[0].text, null);
});

test("statuses map onto the domain's forward-only vocabulary", () => {
  const parsed = parseWhatsAppWebhook(
    delivery({
      statuses: [
        {
          id: "wamid.OUT",
          recipient_id: "61412345678",
          status: "sent",
          timestamp: "1758528000",
        },
        {
          id: "wamid.OUT",
          recipient_id: "61412345678",
          status: "delivered",
          timestamp: "1758528010",
        },
        {
          id: "wamid.OUT",
          recipient_id: "61412345678",
          status: "read",
          timestamp: "1758528020",
        },
      ],
    }),
  );
  assert.deepEqual(
    parsed?.statuses.map((status) => [
      status.status,
      status.errorCode,
      status.errorTitle,
    ]),
    [
      ["SENT", null, null],
      ["DELIVERED", null, null],
      ["READ", null, null],
    ],
  );
});

test("a failed status carries Meta's code and an operator-readable title", () => {
  const parsed = parseWhatsAppWebhook(
    delivery({
      statuses: [
        {
          errors: [
            {
              code: 131026,
              error_data: { details: "Message Undeliverable." },
              message: "Message undeliverable",
              title: "Message undeliverable",
            },
          ],
          id: "wamid.OUT",
          recipient_id: "61412345678",
          status: "failed",
          timestamp: "1758528000",
        },
      ],
    }),
  );
  const [failed] = parsed?.statuses ?? [];
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.errorCode, "131026");
  assert.match(failed.errorTitle ?? "", /couldn't deliver to this number/);
});

test("junk is skipped with a reason that carries no body or phone number", () => {
  const parsed = parseWhatsAppWebhook({
    entry: [
      {
        changes: [
          { field: "account_update", value: { phone_number: "61412345678" } },
          {
            field: "messages",
            value: {
              messages: [{ text: { body: "secret words" }, type: "text" }],
              metadata: { phone_number_id: "109876543210987" },
              statuses: [
                { id: "wamid.X", status: "deleted", timestamp: "1758528000" },
              ],
            },
          },
          { field: "messages", value: { messages: [] } },
        ],
        id: "100000000000000",
      },
    ],
    object: "whatsapp_business_account",
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.messages, []);
  assert.deepEqual(parsed.statuses, []);
  assert.equal(parsed.ignored.length, 4);
  const reasons = parsed.ignored.join("\n");
  assert.doesNotMatch(reasons, /secret words|61412345678/);
});

test("a body that is not a WhatsApp Business Account webhook is refused outright", () => {
  assert.equal(parseWhatsAppWebhook({ entry: [], object: "page" }), null);
  assert.equal(parseWhatsAppWebhook("nonsense"), null);
  assert.equal(parseWhatsAppWebhook(null), null);
});
