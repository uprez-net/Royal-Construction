import assert from "node:assert/strict";
import { MilestoneStatus } from "@prisma/client";
import { test } from "vitest";

import { waiverDates } from "@/components/projects/detail/waiver-dates";
import { assertMilestoneFieldsForStatus } from "@/lib/domain/projects/milestones";
import { sydneyToday } from "@/lib/dates/sydney";
import { milestoneUpdateSchema } from "@/utils/validators";

// The activity dialog hides its date fields for "Not required" but keeps the
// stored dates, so a waiver must submit dates the domain accepts.

// 12:30 UTC on 13 Nov is 11:30 pm in Sydney but already the 14th in
// Auckland: the clamp must use Sydney's day, as the domain guard does.
const now = new Date("2026-11-13T12:30:00Z");
const today = sydneyToday(now);

test("the clamp is Sydney's day, not the browser's", () => {
  assert.equal(today, "2026-11-13");
  const dates = waiverDates(
    { actualDate: "2026-12-01", status: MilestoneStatus.NOT_REQUIRED },
    today,
  );
  assert.equal(dates.actualDate, "2026-11-13");
  assertMilestoneFieldsForStatus(dates, now);
});

test("a later start date is pulled back to the clamped completion date", () => {
  const dates = waiverDates(
    {
      actualDate: "2026-12-01",
      startDate: "2026-11-20",
      status: MilestoneStatus.NOT_REQUIRED,
    },
    today,
  );
  assert.deepEqual(
    [dates.startDate, dates.actualDate],
    ["2026-11-13", "2026-11-13"],
  );
  assertMilestoneFieldsForStatus(dates, now);
});

test("past dates, a start-only waiver and other statuses are left alone", () => {
  const past = {
    actualDate: "2026-11-05",
    startDate: "2026-11-01",
    status: MilestoneStatus.NOT_REQUIRED,
  };
  assert.deepEqual(waiverDates(past, today), past);
  const startOnly = {
    startDate: "2026-11-20",
    status: MilestoneStatus.NOT_REQUIRED,
  };
  assert.deepEqual(waiverDates(startOnly, today), startOnly);
  const done = {
    actualDate: "2026-12-01",
    startDate: "2026-11-20",
    status: MilestoneStatus.DONE,
  };
  assert.equal(waiverDates(done, today), done);
});

test("a date cleared in the picker does not block a waiver on a hidden field", () => {
  const dates = waiverDates(
    {
      actualDate: "",
      startDate: "",
      status: MilestoneStatus.NOT_REQUIRED,
      targetDate: "2026-11-20",
    },
    today,
  );
  assert.equal(milestoneUpdateSchema.safeParse(dates).success, true);
  assert.equal(dates.actualDate, undefined);
  assert.equal(dates.startDate, undefined);
});
