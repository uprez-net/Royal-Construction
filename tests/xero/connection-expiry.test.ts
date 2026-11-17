import assert from "node:assert/strict";
import { test } from "vitest";
import { xeroConnectionExpiry } from "@/lib/xero/connection-expiry";

// One rule for the Xero page and the Admin hub: they must agree on the edges.
const now = new Date("2026-11-17T00:00:00Z");
const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000);

test("classifies the refresh token's expiry at its edges", () => {
  assert.equal(xeroConnectionExpiry(null, now).state, "ok");
  assert.equal(xeroConnectionExpiry(inDays(15), now).state, "ok");
  assert.equal(xeroConnectionExpiry(inDays(14), now).state, "expiring");
  assert.equal(xeroConnectionExpiry(inDays(1), now).state, "expiring");
  assert.equal(xeroConnectionExpiry(inDays(0), now).state, "expired");
  assert.equal(xeroConnectionExpiry(inDays(-3), now).state, "expired");
  assert.equal(xeroConnectionExpiry(inDays(14), now).daysLeft, 14);
});
