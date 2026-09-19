import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  signBookConsultationToken,
  verifyBookConsultationToken,
} from "../../lib/leads/book-consultation-token";

const SECRET = "x".repeat(40);

test("a signed token verifies for the same lead", () => {
  const token = signBookConsultationToken(42, SECRET);
  assert.ok(token);
  assert.equal(verifyBookConsultationToken(token!, 42, SECRET), true);
});

test("a token for another lead is rejected", () => {
  const token = signBookConsultationToken(42, SECRET);
  assert.equal(verifyBookConsultationToken(token!, 43, SECRET), false);
});

test("the public booking route does not trust a bare id", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/graph/book-consultant/route.ts"),
    "utf8",
  );
  assert.ok(source.includes("resolveAuthorizedLeadId"));
  assert.ok(source.includes("verifyBookConsultationToken"));
  assert.ok(!source.includes("findLeadByEmail(id)"));
});
