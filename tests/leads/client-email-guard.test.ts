import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "vitest";

import { consultationBookingKey } from "@/lib/domain/leads/booking";
import {
  introducesOwnMailbox,
  ownMailboxRefusal,
} from "@/lib/domain/leads/client-email";
import { DomainValidationError } from "@/lib/domain/errors";

// #590: four leads exist whose client email is one of our own mailboxes.
const KEYS = ["BUSINESS_EMAIL", "BUSINESS_ADMIN_EMAIL", "MAIL_ID_CC"] as const;
const saved: Partial<Record<(typeof KEYS)[number], string>> = {};

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.BUSINESS_EMAIL = "info@royal.test";
  process.env.BUSINESS_ADMIN_EMAIL = "admin@royal.test";
  Reflect.deleteProperty(process.env, "MAIL_ID_CC");
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = saved[key];
  }
});

describe("own mailbox as a client email", () => {
  test("every mailbox of ours is refused, whatever the case or spacing", () => {
    for (const address of [
      "info@royal.test",
      " Admin@Royal.test ",
      "info@royalconstructions.com.au",
    ]) {
      assert.ok(ownMailboxRefusal(address), address);
    }
  });

  test("a client's address, and nothing, are allowed", () => {
    assert.equal(ownMailboxRefusal("client@gmail.test"), null);
    assert.equal(ownMailboxRefusal(""), null);
    assert.equal(ownMailboxRefusal(undefined), null);
  });

  test("an edit is judged only when it changes the address", () => {
    // A lead already holding info@ stays editable until it is corrected.
    assert.equal(introducesOwnMailbox("info@royal.test", "info@royal.test"), false);
    assert.equal(introducesOwnMailbox(undefined, "info@royal.test"), false);
    assert.equal(introducesOwnMailbox("", "info@royal.test"), false);
    // Setting one is refused; moving off one is fine.
    assert.equal(introducesOwnMailbox("admin@royal.test", "c@gmail.test"), true);
    assert.equal(introducesOwnMailbox("c@gmail.test", "info@royal.test"), false);
  });

  test("a booking from our own address is refused before the calendar is touched", () => {
    const slot = { email: "Info@Royal.test", name: "Test", startsAt: new Date() };
    assert.throws(
      () => consultationBookingKey(slot),
      (error) =>
        error instanceof DomainValidationError && /own mailboxes/.test(error.message),
    );
    assert.match(
      consultationBookingKey({ ...slot, email: "client@gmail.test" }),
      /^consultation:/,
    );
  });
});
