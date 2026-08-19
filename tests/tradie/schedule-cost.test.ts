import assert from "node:assert/strict";
import { test } from "node:test";

import { NORMAL_WORKING_HOURS, scheduleTotalCost } from "../../utils/calculations";

test("an hourly price is costed per site day", () => {
  assert.equal(scheduleTotalCost(120, 3, "HOURLY"), 120 * NORMAL_WORKING_HOURS * 3);
});

test("a fixed price is the whole job, however long it takes", () => {
  // The bug this exists for: 4800 quoted for a 5-day job used to report
  // 4800 x 8 x 5 = $192,000.
  assert.equal(scheduleTotalCost(4800, 5, "FIXED"), 4800);
  assert.equal(scheduleTotalCost(4800, 1, "FIXED"), 4800);
});

test("duration does not change a fixed price", () => {
  const one = scheduleTotalCost(2500, 1, "FIXED");
  const ten = scheduleTotalCost(2500, 10, "FIXED");
  assert.equal(one, ten);
});

test("hourly still scales with duration", () => {
  assert.ok(scheduleTotalCost(100, 5, "HOURLY") > scheduleTotalCost(100, 1, "HOURLY"));
});

test("zero duration costs nothing hourly but still owes a fixed quote", () => {
  assert.equal(scheduleTotalCost(120, 0, "HOURLY"), 0);
  assert.equal(scheduleTotalCost(4800, 0, "FIXED"), 4800);
});

/* ── display ───────────────────────────────────────────────────────── */

import { formatQuotedPrice } from "../../utils/calculations";

const money = (n: number) => `$${n.toFixed(2)}`;

test("a fixed price never renders as a rate", () => {
  // "/hr" was hardcoded at five display sites, so recording the unit changed
  // the maths while every screen still said per-hour.
  const shown = formatQuotedPrice(4800, "FIXED", money);
  assert.ok(!shown.includes("/hr"), `fixed price rendered as a rate: ${shown}`);
  assert.match(shown, /fixed/);
});

test("an hourly price still renders as a rate", () => {
  assert.equal(formatQuotedPrice(120, "HOURLY", money), "$120.00/hr");
});
