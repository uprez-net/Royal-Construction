import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { redactRecord, redactText } from "@/lib/observability/redact";

describe("redactText — client details never leave for a third party", () => {
  test("an email address inside a provider's response body", () => {
    const message =
      'Graph error 500: {"to":"jane.citizen+quote@example.com.au","code":"ErrorX"}';
    const out = redactText(message);
    assert.ok(!out.includes("jane.citizen"), out);
    assert.ok(out.includes("[email]"), out);
    assert.ok(out.includes("ErrorX"), "the diagnostic part survives");
  });

  test("Australian mobiles and landlines in common groupings", () => {
    for (const phone of [
      "0412345678",
      "0412 345 678",
      "04-1234-5678",
      "+61412345678",
      "+61 412 345 678",
      "02 9876 5432",
    ]) {
      assert.equal(
        redactText(`call ${phone} back`),
        "call [phone] back",
        phone,
      );
    }
  });

  test("a bearer token and a database URL", () => {
    assert.equal(
      redactText("Authorization: Bearer abc.def-123_xyz=="),
      "Authorization: Bearer [token]",
    );
    assert.equal(
      redactText(
        "connect postgresql://user:pw@host:5432/db?sslmode=require failed",
      ),
      "connect [connection-string] failed",
    );
  });

  test("ids, statuses and timestamps are left alone", () => {
    const text = "lead 1234567 status 503 at 1699999999999 run wrun_01ABC";
    assert.equal(redactText(text), text);
  });
});

describe("redactRecord", () => {
  test("redacts string values one level deep and keeps the rest", () => {
    const out = redactRecord({
      note: "email a@b.com",
      count: 3,
      nested: { keep: "a@b.com" },
    });
    assert.equal(out.note, "email [email]");
    assert.equal(out.count, 3);
    assert.deepEqual(out.nested, { keep: "a@b.com" });
  });
});
