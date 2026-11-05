import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  ccWithSender,
  DEFAULT_BUSINESS_EMAIL,
  isOwnMailbox,
  isSenderCopy,
  resolveLeadEmail,
} from "@/lib/graph/mailbox";

const ENV_KEYS = [
  "BUSINESS_EMAIL",
  "GRAPH_SENDER_UPN",
  "BUSINESS_ADMIN_EMAIL",
  "GRAPH_ADMIN_SENDER_UPN",
  "MAIL_ID_CC",
  "GRAPH_ADMIN_MAIL_CC",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("isOwnMailbox", () => {
  it("recognises the hardcoded business address with no env configured", () => {
    assert.equal(isOwnMailbox(DEFAULT_BUSINESS_EMAIL), true);
  });

  it("ignores case and surrounding whitespace", () => {
    assert.equal(isOwnMailbox("  INFO@RoyalConstructions.com.AU "), true);
  });

  it("recognises each configured mailbox", () => {
    process.env.BUSINESS_EMAIL = "hello@royalconstructions.com.au";
    process.env.GRAPH_SENDER_UPN = "noreply@royalconstructions.com.au";
    assert.equal(isOwnMailbox("hello@royalconstructions.com.au"), true);
    assert.equal(isOwnMailbox("noreply@royalconstructions.com.au"), true);
  });

  it("recognises the configured admin mailbox", () => {
    process.env.BUSINESS_ADMIN_EMAIL = "compliance@royalconstructions.com.au";
    assert.equal(isOwnMailbox("compliance@royalconstructions.com.au"), true);
  });

  it("splits a comma-separated CC list", () => {
    process.env.MAIL_ID_CC =
      "sales@royalconstructions.com.au, admin@royalconstructions.com.au";
    assert.equal(isOwnMailbox("admin@royalconstructions.com.au"), true);
  });

  it("does not claim a client address", () => {
    assert.equal(isOwnMailbox("umaa.janakan@gmail.co"), false);
  });

  it("treats empty and missing input as not ours", () => {
    assert.equal(isOwnMailbox(""), false);
    assert.equal(isOwnMailbox("   "), false);
    assert.equal(isOwnMailbox(undefined), false);
    assert.equal(isOwnMailbox(null), false);
  });
});

describe("resolveLeadEmail", () => {
  it("takes the body address when our own mailbox relayed the form", () => {
    // The regression that put info@ on lead 223.
    assert.equal(
      resolveLeadEmail(DEFAULT_BUSINESS_EMAIL, "umaa.janakan@gmail.co"),
      "umaa.janakan@gmail.co",
    );
  });

  it("keeps the envelope sender for a direct enquiry", () => {
    assert.equal(
      resolveLeadEmail("client@example.com", ""),
      "client@example.com",
    );
  });

  it("prefers the verified sender over a differing body address", () => {
    assert.equal(
      resolveLeadEmail("client@example.com", "someone.else@example.com"),
      "client@example.com",
    );
  });

  it("falls back to the body address when there is no sender", () => {
    assert.equal(
      resolveLeadEmail("", "client@example.com"),
      "client@example.com",
    );
    assert.equal(
      resolveLeadEmail(undefined, "client@example.com"),
      "client@example.com",
    );
  });

  it("never returns one of our own addresses", () => {
    // Both sides ours: an empty lead email is recoverable, a poisoned gate is not.
    assert.equal(
      resolveLeadEmail(DEFAULT_BUSINESS_EMAIL, DEFAULT_BUSINESS_EMAIL),
      "",
    );
    assert.equal(resolveLeadEmail(DEFAULT_BUSINESS_EMAIL, ""), "");
  });

  it("lowercases and trims what it returns", () => {
    assert.equal(
      resolveLeadEmail("  Client@Example.COM  ", ""),
      "client@example.com",
    );
  });
});

describe("ccWithSender", () => {
  it("adds the sending mailbox to an empty CC", () => {
    assert.deepEqual(
      ccWithSender("info@royalconstructions.com.au", {
        to: "client@example.com",
      }),
      ["info@royalconstructions.com.au"],
    );
  });

  it("keeps the caller's CC and appends the sender", () => {
    assert.deepEqual(
      ccWithSender("info@royalconstructions.com.au", {
        to: ["client@example.com"],
        cc: "dhrub@royalconstructions.com.au",
      }),
      ["dhrub@royalconstructions.com.au", "info@royalconstructions.com.au"],
    );
  });

  it("does not add the sender twice when it is already on the message", () => {
    for (const message of [
      { to: "Info@RoyalConstructions.com.au" },
      { to: "client@example.com", cc: ["info@royalconstructions.com.au"] },
      { to: "client@example.com", bcc: "info@royalconstructions.com.au" },
    ]) {
      const cc = ccWithSender("info@royalconstructions.com.au", message);
      const copies = (cc ?? []).filter(
        (address) => address.toLowerCase() === "info@royalconstructions.com.au",
      );
      assert.ok(copies.length <= 1, JSON.stringify(message));
    }
    assert.equal(
      ccWithSender("info@royalconstructions.com.au", {
        to: "info@royalconstructions.com.au",
      }),
      undefined,
    );
  });

  it("leaves CC alone when the sender is unknown", () => {
    assert.equal(
      ccWithSender(undefined, { to: "client@example.com" }),
      undefined,
    );
    assert.deepEqual(
      ccWithSender("  ", { to: "client@example.com", cc: "a@example.com" }),
      ["a@example.com"],
    );
  });
});

describe("isSenderCopy", () => {
  it("recognises our own send CC'd back to the same mailbox", () => {
    assert.equal(
      isSenderCopy({
        from: DEFAULT_BUSINESS_EMAIL,
        cc: [DEFAULT_BUSINESS_EMAIL.toUpperCase()],
      }),
      true,
    );
  });

  it("does not swallow a website form relayed by our mailbox to itself", () => {
    assert.equal(isSenderCopy({ from: DEFAULT_BUSINESS_EMAIL, cc: [] }), false);
  });

  it("does not swallow a client who CCs our address", () => {
    assert.equal(
      isSenderCopy({
        from: "client@example.com",
        cc: ["client@example.com", DEFAULT_BUSINESS_EMAIL],
      }),
      false,
    );
  });
});
