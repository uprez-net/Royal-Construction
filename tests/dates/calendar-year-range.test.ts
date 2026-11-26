import assert from "node:assert/strict";
import { test } from "vitest";

import {
  CALENDAR_YEARS_AHEAD,
  defaultCalendarEndMonth,
} from "@/components/ui/calendar";

// react-day-picker's year dropdown stops at December of the current year
// unless told otherwise, so in late November 2026 no activity date could be
// set in 2027. The shared Calendar now reaches years ahead by default.

test("the year dropdown reaches past the end of this year", () => {
  const end = defaultCalendarEndMonth(new Date(2026, 10, 26));
  assert.equal(end.getFullYear(), 2026 + CALENDAR_YEARS_AHEAD);
  assert.equal(end.getMonth(), 11);
  assert.ok(CALENDAR_YEARS_AHEAD >= 2);
});
