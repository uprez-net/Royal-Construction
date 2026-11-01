import assert from "node:assert/strict";

import { describe, test } from "vitest";

import { parseStrictIsoDateTime } from "@/lib/dates/iso-datetime";

// The sent-mail backfill's `?since=`: only a time that means one instant.

describe("parseStrictIsoDateTime", () => {
  test("reads a zoned ISO datetime as its instant", () => {
    assert.equal(
      parseStrictIsoDateTime("2026-11-01T00:00:00Z")?.toISOString(),
      "2026-11-01T00:00:00.000Z",
    );
    assert.equal(
      parseStrictIsoDateTime("2026-11-01T10:00+10:00")?.toISOString(),
      "2026-11-01T00:00:00.000Z",
    );
    assert.equal(
      parseStrictIsoDateTime("2026-11-01T00:00:00.123Z")?.toISOString(),
      "2026-11-01T00:00:00.123Z",
    );
  });

  test("refuses anything without an explicit zone, or not a datetime", () => {
    for (const text of [
      "2026-11-01",
      "2026-11-01T00:00:00",
      "2026-11",
      "November 1 2026",
      "1",
      "",
    ]) {
      assert.equal(parseStrictIsoDateTime(text), null, text);
    }
  });

  test("refuses a day, time or offset out of range", () => {
    for (const text of [
      "2026-02-29T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-11-01T24:00:00Z",
      "2026-11-01T00:60:00Z",
      "2026-11-01T00:00:60Z",
      "2026-11-01T00:00:00+15:00",
    ]) {
      assert.equal(parseStrictIsoDateTime(text), null, text);
    }
    assert.ok(parseStrictIsoDateTime("2028-02-29T00:00:00Z"));
  });
});
