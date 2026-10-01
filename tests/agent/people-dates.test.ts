import assert from "node:assert/strict";
import { test } from "vitest";

import { currentSydneyTimeInstructions } from "@/agent/lib/current-time-instructions";
import {
  formatDisplayField,
  formatDisplayMarkdown,
  formatDisplayValue,
  toInputFields,
} from "@/components/agent/agent-format";
import {
  formatIsoForPeople,
  humanizeIsoDatesInText,
  nextSydneyOffsetChange,
  sydneyUtcOffset,
} from "@/lib/dates/sydney";

/**
 * The operations agent passed ISO strings straight to the office: the
 * approval card read "Due At 2026-09-25T00:00:00.000Z" and the model repeated
 * them in prose. People read Australian dates on the Sydney clock.
 */

test("a timestamp reads as a Sydney date and time", () => {
  assert.equal(
    formatIsoForPeople("2026-09-24T23:00:00.000Z"),
    "Fri 25 Sept 2026, 9:00 am AEST",
  );
  assert.equal(
    formatIsoForPeople("2026-10-10T09:30:00+11:00"),
    "Sat 10 Oct 2026, 9:30 am AEDT",
  );
});

test("a timestamp on Sydney midnight is a day-level date, not 12:00 am", () => {
  assert.equal(
    formatIsoForPeople("2026-09-24T14:00:00.000Z"),
    "Fri 25 Sept 2026",
  );
});

test("a timestamp with an impossible written calendar date is rejected", () => {
  assert.equal(formatIsoForPeople("2026-02-30T09:00:00+11:00"), null);
  assert.equal(
    formatIsoForPeople("2024-02-29T09:00:00+11:00"),
    "Thu 29 Feb 2024, 9:00 am AEDT",
  );
});

test("a bare calendar date is not shifted through a time zone", () => {
  assert.equal(formatIsoForPeople("2026-09-25"), "Fri 25 Sept 2026");
  assert.equal(formatIsoForPeople("2026-02-30"), null);
});

test("dates inside prose are rewritten; identifiers and zone-less times are not", () => {
  assert.equal(
    humanizeIsoDatesInText(
      "Due 2026-09-24T23:00:00Z, created 2026-09-01. File quote-2026-09-25.pdf; local 2026-09-25T09:00.",
    ),
    "Due Fri 25 Sept 2026, 9:00 am AEST, created Tue 1 Sept 2026. File quote-2026-09-25.pdf; local 2026-09-25T09:00.",
  );
});

test("dates in URLs and Markdown destinations stay unchanged", () => {
  assert.equal(
    humanizeIsoDatesInText(
      "Due 2026-09-25; https://example.test/2026-09-25?at=2026-09-25 and [booking 2026-09-25](https://example.test/2026-09-25?day=2026-09-25) and [archive](/events/(archive)/2026-09-25).",
    ),
    "Due Fri 25 Sept 2026; https://example.test/2026-09-25?at=2026-09-25 and [booking Fri 25 Sept 2026](https://example.test/2026-09-25?day=2026-09-25) and [archive](/events/(archive)/2026-09-25).",
  );
});

test("approval fields and card values show people-facing dates", () => {
  const [due] = toInputFields({ dueAt: "2026-09-24T23:00:00.000Z" });
  assert.equal(due?.value, "Fri 25 Sept 2026, 9:00 am AEST");
  assert.equal(formatDisplayValue("2026-09-25"), "Fri 25 Sept 2026");
  assert.equal(formatDisplayValue(3), "3");
  assert.equal(formatDisplayValue("Negotiating"), "Negotiating");
});

test("assistant markdown is rewritten outside code only", () => {
  assert.equal(
    formatDisplayMarkdown(
      "Due **2026-09-25**. Raw: `2026-09-25` and\n```\n2026-09-24T23:00:00Z\n```",
    ),
    "Due **Fri 25 Sept 2026**. Raw: `2026-09-25` and\n```\n2026-09-24T23:00:00Z\n```",
  );
});

test("Sydney's offset and its next change do not depend on the server's zone", () => {
  const september = new Date("2026-09-23T00:00:00Z");
  assert.equal(sydneyUtcOffset(september), "+10:00");
  assert.equal(sydneyUtcOffset(new Date("2026-12-01T00:00:00Z")), "+11:00");
  // Daylight saving starts 2:00 am Sun 4 Oct 2026 AEST.
  assert.equal(
    nextSydneyOffsetChange(september)?.toISOString(),
    "2026-10-03T16:00:00.000Z",
  );
});

test("the agent is told today's Sydney date, the offset, and the house style", () => {
  const text = currentSydneyTimeInstructions(new Date("2026-09-23T00:45:00Z"));
  assert.match(text, /Wed 23 Sept 2026, 10:45 am AEST/);
  assert.match(text, /Today's Sydney date is 2026-09-23/);
  assert.match(text, /UTC\+10:00/);
  assert.match(text, /changes to UTC\+11:00 \(AEDT\) on Sun 4 Oct 2026/);
  assert.match(text, /2:00 am/);
  assert.match(text, /1:00 am is still AEST \(UTC\+10:00\)/);
  assert.match(text, /9:00 am booking is AEDT \(UTC\+11:00\)/);
  assert.match(
    text,
    /sydneyWallClockToInstant and checking the resulting instant with sydneyUtcOffset/,
  );
  assert.match(text, /2026-09-23T09:00:00\+10:00/);
  assert.match(text, /Never show ISO strings/);
});

test("a 9 am example uses the offset at 9 am even before the DST transition", () => {
  const text = currentSydneyTimeInstructions(new Date("2026-10-03T15:00:00Z"));
  assert.match(text, /such as 2026-10-04T09:00:00\+11:00/);
});

test("a field the sender labelled UTC is shown in UTC, not Sydney time", () => {
  // A lead-task card read "Due At Utc · Fri 2 Oct 2026, 10:00 am AEST".
  assert.equal(
    formatDisplayField("dueAtUtc", "2026-10-02T00:00:00Z"),
    "2026-10-02 00:00 UTC",
  );
  assert.equal(
    formatDisplayField("dueAt", "2026-10-02T00:00:00Z"),
    formatDisplayValue("2026-10-02T00:00:00Z"),
  );
  assert.equal(formatDisplayField("noteUtc", "not a date"), "not a date");
});
