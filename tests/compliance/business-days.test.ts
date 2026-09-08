import assert from "node:assert/strict";
import test from "node:test";

import {
  businessDaysBetween,
  isNswBusinessDay,
} from "../../lib/dates/business-days";

/**
 * The clock every overdue alert on the compliance file is measured on.
 *
 * Worth testing rather than eyeballing because the failure is invisible in both
 * directions: counted too generously, a surveyor sits unchased for a fortnight;
 * counted too meanly, every alert fires a day early through a long weekend and
 * the panel stops being read. Neither shows up as an error anywhere.
 *
 * Sydney dates throughout. `new Date("2026-06-08T00:00:00+10:00")` is Sydney
 * midnight; writing these as bare UTC instants would put half of them on the
 * previous day and quietly test something else.
 */

const sydney = (value: string) => new Date(`${value}+10:00`);
/** Daylight saving. Sydney is +11 from October to April. */
const sydneyDst = (value: string) => new Date(`${value}+11:00`);

test("weekends are not working days", () => {
  // 2026-06-06 is a Saturday, 2026-06-07 a Sunday.
  assert.equal(isNswBusinessDay("2026-06-05"), true);
  assert.equal(isNswBusinessDay("2026-06-06"), false);
  assert.equal(isNswBusinessDay("2026-06-07"), false);
  assert.equal(isNswBusinessDay("2026-06-09"), true);
});

test("NSW public holidays are not working days", () => {
  // King's Birthday — the second Monday in June.
  assert.equal(isNswBusinessDay("2026-06-08"), false);
  // Anzac Day 2026 falls on a Saturday and is not substituted in NSW, so the
  // Monday after it is an ordinary working day.
  assert.equal(isNswBusinessDay("2026-04-27"), true);
  // Australia Day 2026 is a Monday.
  assert.equal(isNswBusinessDay("2026-01-26"), false);
});

test("Easter is computed rather than tabulated", () => {
  // Easter Sunday 2026 is 5 April. Good Friday through Easter Monday.
  assert.equal(isNswBusinessDay("2026-04-03"), false);
  assert.equal(isNswBusinessDay("2026-04-06"), false);
  assert.equal(isNswBusinessDay("2026-04-07"), true);

  // A year well outside any list anybody would have hand-written: Easter
  // Sunday 2031 is 13 April.
  assert.equal(isNswBusinessDay("2031-04-11"), false);
  assert.equal(isNswBusinessDay("2031-04-14"), false);
});

test("the day something is lodged counts as zero", () => {
  const lodged = sydney("2026-06-01T09:00:00");
  assert.equal(businessDaysBetween(lodged, sydney("2026-06-01T17:00:00")), 0);
  assert.equal(businessDaysBetween(lodged, sydney("2026-06-02T09:00:00")), 1);
});

test("a working week counts five, not seven", () => {
  // Monday 1 June to the following Monday.
  assert.equal(
    businessDaysBetween(sydney("2026-06-01T09:00:00"), sydney("2026-06-08T09:00:00")),
    // The 8th is the King's Birthday, so the Monday itself does not count.
    4,
  );
  assert.equal(
    businessDaysBetween(sydney("2026-06-01T09:00:00"), sydney("2026-06-05T09:00:00")),
    4,
  );
});

test("a clock cannot run backwards", () => {
  // A lodgement date typed in as next month must not read as "not due yet" for
  // a month. Zero is the honest answer to a wait that has not started.
  assert.equal(
    businessDaysBetween(sydney("2026-07-01T09:00:00"), sydney("2026-06-01T09:00:00")),
    0,
  );
});

test("the boundary is a Sydney date, not a UTC one", () => {
  // 2026-02-02T09:00+11:00 is 2026-02-01T22:00Z — a Sunday in UTC and a Monday
  // in Sydney. Read as UTC this lands a day early and every threshold with it.
  const mondayMorningSydney = sydneyDst("2026-02-02T09:00:00");
  assert.equal(
    businessDaysBetween(mondayMorningSydney, sydneyDst("2026-02-03T09:00:00")),
    1,
  );
});

test("the portal's five days clear a long weekend", () => {
  // Lodged the Thursday before the June long weekend. Five working days later
  // is the following Thursday, not the Tuesday a calendar count would claim.
  const lodged = sydney("2026-06-04T10:00:00");
  assert.equal(businessDaysBetween(lodged, sydney("2026-06-09T10:00:00")), 2);
  assert.equal(businessDaysBetween(lodged, sydney("2026-06-11T10:00:00")), 4);
  assert.equal(businessDaysBetween(lodged, sydney("2026-06-12T10:00:00")), 5);
});
