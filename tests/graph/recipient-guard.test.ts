import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

import { createGraphContext } from "@/lib/graph/client";
import type { GraphConfig } from "@/lib/graph/config";
import {
  assertDeliverableRecipients,
  reservedRecipients,
} from "@/lib/graph/recipient-guard";

vi.mock("@azure/identity", () => ({
  ClientSecretCredential: class {
    getToken = async () => ({ token: "test-token" });
  },
  DeviceCodeCredential: class {
    getToken = async () => ({ token: "test-token" });
  },
}));

// #591: placeholder and test recipients reached real inboxes in production
// because no send checked who it was addressed to.
const PRODUCTION = { APP_ENV: undefined, VERCEL_ENV: "production" };
const STAGING = { APP_ENV: "staging", VERCEL_ENV: "production" };

describe("reservedRecipients", () => {
  test("reserved domains and TLDs are found, whatever the case or form", () => {
    assert.deepEqual(
      reservedRecipients(
        ["a@example.com", "B@Example.ORG", "c@mail.example.net"],
        "d@client.test",
        ["e@x.invalid", "Name <f@box.localhost>", "g@localhost"],
      ),
      [
        "a@example.com",
        "B@Example.ORG",
        "c@mail.example.net",
        "d@client.test",
        "e@x.invalid",
        "Name <f@box.localhost>",
        "g@localhost",
      ],
    );
  });

  test("real domains are left alone, including look-alikes", () => {
    assert.deepEqual(
      reservedRecipients(
        ["client@gmail.com", "x@royalconstructions.com.au"],
        "y@notexample.com",
        undefined,
      ),
      [],
    );
  });
});

describe("assertDeliverableRecipients", () => {
  test("production refuses a reserved recipient in To, Cc or Bcc", () => {
    for (const field of ["to", "cc", "bcc"] as const) {
      assert.throws(
        () =>
          assertDeliverableRecipients(
            { to: "client@gmail.com", [field]: ["t@example.com"] },
            PRODUCTION,
          ),
        /reserved test domain/,
        field,
      );
    }
  });

  test("the refusal does not repeat the address", () => {
    try {
      assertDeliverableRecipients({ to: "secret@example.com" }, PRODUCTION);
      assert.fail("should have thrown");
    } catch (error) {
      assert.doesNotMatch(String((error as Error).message), /secret/);
    }
  });

  test("staging and development send to test domains on purpose", () => {
    assertDeliverableRecipients({ to: "a@example.com" }, STAGING);
    assertDeliverableRecipients({ to: "a@client.test" }, {});
  });

  test("a real recipient passes in production", () => {
    assertDeliverableRecipients(
      { to: ["client@gmail.com"], cc: "office@royalconstructions.com.au" },
      PRODUCTION,
    );
  });
});

describe("sendMail", () => {
  const CONFIG: GraphConfig = {
    mailbox: "admin",
    mode: "app-only",
    tenantId: "tenant",
    clientId: "client",
    clientSecret: "secret",
    senderUpn: "office@royalconstructions.com.au",
    senderUserId: "user",
    defaultRecipient: "to@example.test",
    defaultSubject: "subject",
    defaultBody: "body",
    webhookSubscriptionMinutes: 60,
  };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ["APP_ENV", "VERCEL_ENV"]) saved[key] = process.env[key];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  test("in production a reserved recipient sends nothing; a real one goes", async () => {
    Reflect.deleteProperty(process.env, "APP_ENV");
    process.env.VERCEL_ENV = "production";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response("{}", { status: 202 });
      }),
    );
    const client = await createGraphContext(CONFIG);
    await assert.rejects(
      client.sendMail({
        to: "kdd@example.com",
        subject: "Documents",
        body: "<p>hi</p>",
      }),
      /reserved test domain/,
    );
    assert.deepEqual(
      calls.filter((url) => url.includes("sendMail")),
      [],
    );

    await client.sendMail({
      to: "client@gmail.com",
      subject: "Documents",
      body: "<p>hi</p>",
    });
    assert.equal(calls.filter((url) => url.includes("sendMail")).length, 1);
  });
});
