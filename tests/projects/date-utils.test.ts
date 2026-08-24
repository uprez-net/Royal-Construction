import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeDateString,
  formatDisplayDate,
  compareSignedAndStartDates,
  SIGNED_START_TOLERANCE_DAYS,
} from "../../utils/date";

// ---------------------------------------------------------------------------
// normalizeDateString — OCR formats
// ---------------------------------------------------------------------------

test("normalizeDateString parses yyyy-MM-dd without timezone drift", () => {
  assert.equal(normalizeDateString("2026-06-12"), "2026-06-12");
});

test("normalizeDateString parses DD/MM/YYYY", () => {
  assert.equal(normalizeDateString("12/06/2026"), "2026-06-12");
});

test("normalizeDateString parses DD-MM-YYYY", () => {
  assert.equal(normalizeDateString("12-06-2026"), "2026-06-12");
});

test("normalizeDateString parses DD.MM.YYYY", () => {
  assert.equal(normalizeDateString("12.06.2026"), "2026-06-12");
});

test("normalizeDateString parses '12 June 2026'", () => {
  assert.equal(normalizeDateString("12 June 2026"), "2026-06-12");
});

test("normalizeDateString parses '12th June 2026'", () => {
  assert.equal(normalizeDateString("12th June 2026"), "2026-06-12");
});

test("normalizeDateString parses 'June 12, 2026'", () => {
  assert.equal(normalizeDateString("June 12, 2026"), "2026-06-12");
});

test("normalizeDateString parses 'June 12th, 2026'", () => {
  assert.equal(normalizeDateString("June 12th, 2026"), "2026-06-12");
});

test("normalizeDateString parses '12th Day of June 2026'", () => {
  assert.equal(normalizeDateString("12th Day of June 2026"), "2026-06-12");
});

test("normalizeDateString parses '12th day of June, 2026'", () => {
  assert.equal(normalizeDateString("12th day of June, 2026"), "2026-06-12");
});

test("normalizeDateString parses 'the 12th day of June, 2026'", () => {
  assert.equal(normalizeDateString("the 12th day of June, 2026"), "2026-06-12");
});

test("normalizeDateString parses 'Signed this 12th day of June 2026'", () => {
  assert.equal(
    normalizeDateString("Signed this 12th day of June 2026"),
    "2026-06-12",
  );
});

test("normalizeDateString parses OCR-split year 'Signed this 15 day of June 20 26'", () => {
  assert.equal(
    normalizeDateString("Signed this 15 day of June 20 26"),
    "2026-06-15",
  );
});

test("normalizeDateString parses OCR-split year '15 June 20 26'", () => {
  assert.equal(normalizeDateString("15 June 20 26"), "2026-06-15");
});

test("normalizeDateString parses abbreviated month 'Sep'", () => {
  assert.equal(normalizeDateString("12 Sep 2026"), "2026-09-12");
});

test("normalizeDateString parses 'Sept' variant", () => {
  assert.equal(normalizeDateString("12 Sept 2026"), "2026-09-12");
});

test("normalizeDateString returns null for empty input", () => {
  assert.equal(normalizeDateString(""), null);
});

test("normalizeDateString returns null for unparseable text", () => {
  assert.equal(normalizeDateString("not a date at all"), null);
});

test("normalizeDateString rejects an impossible date like 31 February", () => {
  assert.equal(normalizeDateString("31 February 2026"), null);
});

// ---------------------------------------------------------------------------
// formatDisplayDate — UTC-safe formatting
// ---------------------------------------------------------------------------

test("formatDisplayDate returns null for empty input", () => {
  assert.equal(formatDisplayDate(null), null);
  assert.equal(formatDisplayDate(""), null);
  assert.equal(formatDisplayDate(undefined), null);
});

test("formatDisplayDate formats a yyyy-MM-dd value as 'dd Mon yyyy'", () => {
  // The exact month abbreviation depends on the host ICU data (some
  // environments render "Jun", others "June"), so assert the structure
  // rather than the exact month token.
  const out = formatDisplayDate("2026-06-12");
  assert.ok(out !== null, "expected a formatted date, got null");
  assert.match(out!, /^12 .+ 2026$/);
});

test("formatDisplayDate formats an OCR long-form date", () => {
  const out = formatDisplayDate("12th June 2026");
  assert.ok(out !== null, "expected a formatted date, got null");
  assert.match(out!, /^12 .+ 2026$/);
});

test("formatDisplayDate returns the raw string when it cannot parse", () => {
  assert.equal(formatDisplayDate("garbage"), "garbage");
});

// ---------------------------------------------------------------------------
// compareSignedAndStartDates
// ---------------------------------------------------------------------------

test("compareSignedAndStartDates returns 'ok' for equal dates", () => {
  const result = compareSignedAndStartDates("2026-06-12", "2026-06-12");
  assert.equal(result.state, "ok");
  assert.equal(result.normalizedSignedDate, "2026-06-12");
  assert.equal(result.normalizedStartDate, "2026-06-12");
});

test("compareSignedAndStartDates returns 'ok' when start is after signed within tolerance", () => {
  const result = compareSignedAndStartDates("2026-06-12", "2026-07-01");
  assert.equal(result.state, "ok");
});

test("compareSignedAndStartDates returns 'start_before_signed' when start precedes signed", () => {
  const result = compareSignedAndStartDates("2026-06-12", "2026-05-01");
  assert.equal(result.state, "start_before_signed");
  assert.equal(result.normalizedSignedDate, "2026-06-12");
  assert.equal(result.normalizedStartDate, "2026-05-01");
});

test("compareSignedAndStartDates returns 'signed_far_before_start' beyond the tolerance", () => {
  // Tolerance is 365 days; pick a gap just over a year.
  const result = compareSignedAndStartDates("2026-01-01", "2027-06-01");
  assert.equal(result.state, "signed_far_before_start");
  assert.equal(result.normalizedSignedDate, "2026-01-01");
  assert.equal(result.normalizedStartDate, "2027-06-01");
});

test("compareSignedAndStartDates returns 'ok' when gap is exactly at the tolerance boundary", () => {
  // 365 days = 2026-01-01 to 2027-01-01. The boundary is inclusive (gap >
  // tolerance), so exactly 365 days is 'ok'.
  const result = compareSignedAndStartDates("2026-01-01", "2027-01-01");
  assert.equal(result.state, "ok");
});

test("compareSignedAndStartDates returns 'unparseable' when the signed date is garbage", () => {
  const result = compareSignedAndStartDates("not-a-date", "2026-06-12");
  assert.equal(result.state, "unparseable");
  assert.equal(result.normalizedSignedDate, null);
  assert.equal(result.normalizedStartDate, "2026-06-12");
});

test("compareSignedAndStartDates returns 'unparseable' when the start date is garbage", () => {
  const result = compareSignedAndStartDates("2026-06-12", "not-a-date");
  assert.equal(result.state, "unparseable");
  assert.equal(result.normalizedSignedDate, "2026-06-12");
  assert.equal(result.normalizedStartDate, null);
});

test("compareSignedAndStartDates returns 'unparseable' when both are null", () => {
  const result = compareSignedAndStartDates(null, null);
  assert.equal(result.state, "unparseable");
  assert.equal(result.normalizedSignedDate, null);
  assert.equal(result.normalizedStartDate, null);
});

test("compareSignedAndStartDates normalizes OCR formats before comparing", () => {
  // Signed date in long form, start date in yyyy-MM-dd — both should normalize
  // to the same canonical day for comparison.
  const result = compareSignedAndStartDates(
    "12th June 2026",
    "2026-06-15",
  );
  assert.equal(result.state, "ok");
  assert.equal(result.normalizedSignedDate, "2026-06-12");
  assert.equal(result.normalizedStartDate, "2026-06-15");
});

test("SIGNED_START_TOLERANCE_DAYS is 365", () => {
  assert.equal(SIGNED_START_TOLERANCE_DAYS, 365);
});
