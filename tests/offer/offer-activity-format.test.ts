import assert from "node:assert/strict";
import { test } from "node:test";

import { formatActivityWhen } from "../../lib/offer/activity-format";

// Pins the negotiation timeline's timestamps. They never carried a year, so a
// send or reply from last year read as this year's. Mid-year instants keep the
// year the same in every timezone the suite might run in.

const NOW = new Date("2026-09-15T02:00:00Z");

test("a date in the current year leaves the year off", () => {
  const when = formatActivityWhen("2026-06-10T03:00:00Z", NOW);

  assert.doesNotMatch(when, /2026/);
  assert.match(when, /10/);
});

test("REGRESSION: a date from a prior year shows its year", () => {
  const when = formatActivityWhen("2025-06-10T03:00:00Z", NOW);

  assert.match(when, /2025/);
});
