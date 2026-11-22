import assert from "node:assert/strict";
import { afterEach, describe, test, vi } from "vitest";

import { createGraphContext } from "@/lib/graph/client";
import type { GraphConfig } from "@/lib/graph/config";

vi.mock("@azure/identity", () => ({
  ClientSecretCredential: class {
    getToken = async () => ({ token: "test-token" });
  },
  DeviceCodeCredential: class {
    getToken = async () => ({ token: "test-token" });
  },
}));

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

function stubFetch() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return new Response("{}", { status: 202 });
    }),
  );
  return calls;
}

// #590: every send CC's the sending mailbox, so a message whose To was empty
// still went out, to the office alone, with the client's confirmation in it.
describe("sendMail with no recipient", () => {
  test("an empty or blank To is refused before anything is sent", async () => {
    const calls = stubFetch();
    const client = await createGraphContext(CONFIG);
    for (const to of ["", "   ", [], [" ", ""]]) {
      await assert.rejects(
        client.sendMail({ to, subject: "Confirmed", body: "<p>hi</p>" }),
        /has no recipient/,
      );
    }
    assert.deepEqual(calls.filter((url) => url.includes("sendMail")), []);
  });

  test("a real To is sent", async () => {
    const calls = stubFetch();
    const client = await createGraphContext(CONFIG);
    await client.sendMail({
      to: "client@example.test",
      subject: "Confirmed",
      body: "<p>hi</p>",
    });
    assert.equal(calls.filter((url) => url.includes("sendMail")).length, 1);
  });

  test("a BCC-only send is still allowed", async () => {
    const calls = stubFetch();
    const client = await createGraphContext(CONFIG);
    await client.sendMail({
      to: "",
      bcc: ["a@example.test"],
      subject: "Notice",
      body: "<p>hi</p>",
    });
    assert.equal(calls.filter((url) => url.includes("sendMail")).length, 1);
  });
});
