import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { getGraphConfig } from "../../lib/graph/config";

const ENV_KEYS = [
  "GRAPH_MODE",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "BUSINESS_EMAIL",
  "GRAPH_SENDER_UPN",
  "BUSINESS_ADMIN_EMAIL",
  "GRAPH_ADMIN_SENDER_UPN",
  "MAIL_ID_CC",
  "GRAPH_ADMIN_MAIL_CC",
  "GRAPH_WEBHOOK_CLIENT_STATE",
  "GRAPH_ADMIN_WEBHOOK_CLIENT_STATE",
  "GRAPH_SUBSCRIPTION_RESOURCE",
  "GRAPH_ADMIN_SUBSCRIPTION_RESOURCE",
] as const;

let saved: Record<string, string | undefined> = {};
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));
  for (const key of ENV_KEYS) delete env[key];

  env.GRAPH_MODE = "app-only";
  env.AZURE_TENANT_ID = "tenant";
  env.AZURE_CLIENT_ID = "client";
  env.AZURE_CLIENT_SECRET = "secret";
  env.BUSINESS_EMAIL = "inbox@example.com";
  env.BUSINESS_ADMIN_EMAIL = "compliance@example.com";
  env.GRAPH_WEBHOOK_CLIENT_STATE = "business-state";
  env.GRAPH_ADMIN_WEBHOOK_CLIENT_STATE = "admin-state";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
});

describe("getGraphConfig", () => {
  it("keeps business and admin sender, cc, state, and resource separate", () => {
    env.MAIL_ID_CC = "sales@example.com";
    env.GRAPH_ADMIN_MAIL_CC = "director@example.com";

    const business = getGraphConfig("business");
    const admin = getGraphConfig("admin");

    assert.equal(business.senderUpn, "inbox@example.com");
    assert.equal(business.cc, "sales@example.com");
    assert.equal(business.webhookClientState, "business-state");
    assert.match(
      business.webhookSubscriptionResource ?? "",
      /inbox%40example\.com/,
    );

    assert.equal(admin.senderUpn, "compliance@example.com");
    assert.equal(admin.cc, "director@example.com");
    assert.equal(admin.webhookClientState, "admin-state");
    assert.match(
      admin.webhookSubscriptionResource ?? "",
      /compliance%40example\.com/,
    );
    assert.doesNotMatch(
      admin.webhookSubscriptionResource ?? "",
      /inbox%40example\.com/,
    );
  });

  it("fails closed when the admin mailbox is not configured", () => {
    delete env.BUSINESS_ADMIN_EMAIL;
    delete env.GRAPH_ADMIN_SENDER_UPN;

    assert.throws(() => getGraphConfig("admin"), /Missing admin Graph mailbox/);
  });

  it("uses an explicit admin UPN even in delegated mode", () => {
    env.GRAPH_MODE = "delegated";

    const business = getGraphConfig("business");
    const admin = getGraphConfig("admin");

    assert.equal(
      business.webhookSubscriptionResource,
      "/me/mailFolders('Inbox')/messages",
    );
    assert.match(
      admin.webhookSubscriptionResource ?? "",
      /^\/users\/compliance%40example\.com\//,
    );
  });
});
