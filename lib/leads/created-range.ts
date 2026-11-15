import {
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

import { SYDNEY_TZ } from "@/lib/dates/sydney";

/**
 * The Leads timeframe select means "created in", and this is its one
 * definition. The table and the cards above it both call it, so a card cannot
 * count a different set of leads than the list it opens.
 *
 * Returns the inclusive UTC bounds of the Sydney calendar period, or null for
 * "all" and for no timeframe. Weeks start on Monday. An unknown value falls
 * back to today, as the table always has.
 */
export function createdRangeFor(
  filterTiming: string | undefined,
  now: Date = new Date(),
): { gte: Date; lte: Date } | null {
  if (!filterTiming || filterTiming === "all") return null;

  const sydneyNow = toZonedTime(now, SYDNEY_TZ);
  let start: Date;
  let end: Date;
  switch (filterTiming) {
    case "this_week":
      start = startOfWeek(sydneyNow, { weekStartsOn: 1 });
      end = endOfWeek(sydneyNow, { weekStartsOn: 1 });
      break;
    case "this_month":
      start = startOfMonth(sydneyNow);
      end = endOfMonth(sydneyNow);
      break;
    case "quarter":
      start = startOfQuarter(sydneyNow);
      end = endOfQuarter(sydneyNow);
      break;
    case "this_year":
      start = startOfYear(sydneyNow);
      end = endOfYear(sydneyNow);
      break;
    case "today":
    default:
      start = startOfDay(sydneyNow);
      end = endOfDay(sydneyNow);
  }
  return {
    gte: fromZonedTime(start, SYDNEY_TZ),
    lte: fromZonedTime(end, SYDNEY_TZ),
  };
}

/** What the strip above the cards says it covers. */
export const CREATED_RANGE_LABELS: Record<string, string> = {
  today: "today",
  this_week: "this week",
  this_month: "this month",
  quarter: "this quarter",
  this_year: "this year",
};

/** "Leads created this month", or the all-time wording. */
export function createdRangeCaption(filterTiming: string | undefined): string {
  const label =
    filterTiming && filterTiming !== "all"
      ? (CREATED_RANGE_LABELS[filterTiming] ?? CREATED_RANGE_LABELS.today)
      : null;
  return label ? `Leads created ${label}` : "All leads, whenever created";
}
