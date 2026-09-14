import assert from "node:assert/strict";
import { test } from "node:test";

import { ComplianceExternalApplicationKind } from "@prisma/client";

import { externalApplicationSchema } from "../../utils/validators/compliance";

/**
 * The dates that start a clock, at the boundary they come in through.
 *
 * `appliedAt` and `submittedAt` are not display values. The first opens an
 * application's wait and the second opens a resubmission round, and the overdue
 * sweep measures the council's turnaround from whichever is latest — so a date
 * that arrives one day out is an alert that fires one day early, or sixty
 * working days late on a job nobody is watching.
 *
 * `new Date()` is generous in a way that matters here: it takes a day that does
 * not exist and rolls it forward rather than refusing it, so a NaN check alone
 * lets a date nobody typed through to storage.
 */

const parse = (input: unknown) => externalApplicationSchema.safeParse(input);

const resubmission = (submittedAt: string) => ({
  step: "resubmitted" as const,
  kind: ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
  submittedAt,
});

test("an ordinary date is accepted and parsed", () => {
  const result = parse(resubmission("2026-06-01"));

  assert.ok(result.success);
  assert.equal(
    (result.data as { submittedAt: Date }).submittedAt.toISOString(),
    "2026-06-01T00:00:00.000Z",
  );
});

test("a day that does not exist in its month is refused", () => {
  // `new Date("2026-02-31")` is 3 March, not an error. Stored as `submittedAt`
  // it would start the determination clock on a date nobody chose, three days
  // after the one they typed.
  const result = parse(resubmission("2026-02-31"));

  assert.equal(result.success, false);
});

test("the 29th of a non-leap February is refused", () => {
  assert.equal(parse(resubmission("2026-02-29")).success, false);
  // And accepted in a leap year, so the check is a calendar check rather than a
  // blanket refusal of anything late in February.
  assert.equal(parse(resubmission("2028-02-29")).success, true);
});

test("a thirty-first that does not exist is refused", () => {
  assert.equal(parse(resubmission("2026-04-31")).success, false);
  assert.equal(parse(resubmission("2026-05-31")).success, true);
});

test("a month or day out of range is refused", () => {
  assert.equal(parse(resubmission("2026-13-01")).success, false);
  assert.equal(parse(resubmission("2026-00-10")).success, false);
  assert.equal(parse(resubmission("2026-06-00")).success, false);
});

test("something that is not a date at all is still refused", () => {
  // The check the calendar test sits on top of, kept pinned: `z.coerce.date()`
  // would accept this as an Invalid Date and hand it to Prisma, which stores
  // null and loses the field without saying so.
  assert.equal(parse(resubmission("banana")).success, false);
  assert.equal(parse(resubmission("")).success, false);
});

test("a first lodgement is held to the same calendar", () => {
  // Both steps carry a date and both start a clock, so a check on one of them
  // is a check that can be walked around by using the other control.
  const result = parse({
    step: "applied",
    kind: ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
    appliedAt: "2026-11-31",
  });

  assert.equal(result.success, false);
});

test("a full instant with an offset is left alone", () => {
  // The calendar check reads the date-only form only. A Sydney evening carries
  // a UTC date one day ahead of its local one, and comparing the parsed UTC
  // components against the text would refuse a perfectly good timestamp.
  const result = parse(resubmission("2026-06-01T21:30:00+10:00"));

  assert.ok(result.success);
});
