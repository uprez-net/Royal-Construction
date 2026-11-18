import assert from "node:assert/strict";
import { afterEach, describe, test, vi } from "vitest";

import { createGraphContext } from "@/lib/graph/client";
import type { GraphConfig } from "@/lib/graph/config";

// The client signs in with @azure/identity before it asks Graph anything.
vi.mock("@azure/identity", () => ({
  ClientSecretCredential: class {
    getToken = async () => ({ token: "test-token" });
  },
  DeviceCodeCredential: class {
    getToken = async () => ({ token: "test-token" });
  },
}));

// What Graph defines on the base `attachment` type, which is the type the
// /attachments collection is selected against. `contentId` is not here: it
// exists only on `fileAttachment`.
// https://learn.microsoft.com/en-us/graph/api/resources/attachment
const BASE_ATTACHMENT_PROPERTIES = new Set([
  "contentType",
  "id",
  "isInline",
  "lastModifiedDateTime",
  "name",
  "size",
]);

const CONFIG: GraphConfig = {
  mailbox: "admin",
  mode: "app-only",
  tenantId: "tenant",
  clientId: "client",
  clientSecret: "secret",
  senderUpn: "office@example.test",
  senderUserId: "user",
  defaultRecipient: "to@example.test",
  defaultSubject: "subject",
  defaultBody: "body",
  webhookSubscriptionMinutes: 60,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubGraph(value: unknown[]): { requested: string[] } {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify({ value }), { status: 200 });
    }),
  );
  return { requested };
}

describe("listMessageAttachments", () => {
  test("selects only properties the base attachment type defines", async () => {
    const graph = stubGraph([]);
    const context = await createGraphContext(CONFIG);

    await context.listMessageAttachments("message-1");

    assert.equal(graph.requested.length, 1);
    const url = new URL(graph.requested[0]);
    assert.match(url.pathname, /\/messages\/message-1\/attachments$/);

    const selected = (url.searchParams.get("$select") ?? "").split(",");
    assert.ok(selected.length > 0 && selected[0] !== "", "must still select");
    for (const property of selected) {
      assert.ok(
        BASE_ATTACHMENT_PROPERTIES.has(property),
        `"${property}" is not on microsoft.graph.attachment; Graph answers a select of it with a 400, and every mail path that lists attachments fails`,
      );
    }
  });

  test("never asks for the file bytes", async () => {
    const graph = stubGraph([]);
    const context = await createGraphContext(CONFIG);

    await context.listMessageAttachments("message-1");

    assert.doesNotMatch(graph.requested[0], /contentBytes/);
  });

  test("maps Graph's answer, including the attachment subtype", async () => {
    stubGraph([
      {
        id: "a1",
        name: "plan.pdf",
        contentType: "application/pdf",
        size: 2048,
        isInline: false,
        "@odata.type": "#microsoft.graph.fileAttachment",
      },
      {
        id: "a2",
        name: "Forwarded mail",
        "@odata.type": "#microsoft.graph.itemAttachment",
      },
      { name: "no id, dropped" },
    ]);
    const context = await createGraphContext(CONFIG);

    const listed = await context.listMessageAttachments("message-1");

    assert.deepEqual(listed, [
      {
        id: "a1",
        name: "plan.pdf",
        contentType: "application/pdf",
        size: 2048,
        isInline: false,
        odataType: "#microsoft.graph.fileAttachment",
      },
      {
        id: "a2",
        name: "Forwarded mail",
        contentType: "",
        size: 0,
        isInline: false,
        odataType: "#microsoft.graph.itemAttachment",
      },
    ]);
  });
});
