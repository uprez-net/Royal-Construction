import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const reported: unknown[] = [];
vi.mock("@/lib/observability/report-error", () => ({
  reportError: (_error: unknown, context: unknown) => reported.push(context),
}));

import { signBookConsultationToken } from "@/lib/leads/book-consultation-token";

// #590: a null token is emailed as a tokenless booking link, which the booking
// route refuses. 38 of 44 welcomes went out that way without anyone knowing.
beforeEach(() => {
  reported.length = 0;
});

test("a missing secret is reported, and still returns null", () => {
  assert.equal(signBookConsultationToken(7, null), null);
  assert.equal(reported.length, 1);
  assert.deepEqual((reported[0] as { ids: unknown }).ids, { leadId: 7 });
});

test("a configured secret signs and reports nothing", () => {
  const token = signBookConsultationToken(7, "s".repeat(40));
  assert.match(token ?? "", /^7\.\d+\./);
  assert.equal(reported.length, 0);
});

test("a bad lead id is not a configuration problem", () => {
  assert.equal(signBookConsultationToken(0, null), null);
  assert.equal(reported.length, 0);
});
