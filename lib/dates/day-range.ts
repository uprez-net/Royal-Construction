import { sydneyEndOfDay, sydneyStartOfDay, sydneyToday } from "./sydney";

/**
 * A window of whole Sydney days, as a brief asks for one (#618): "today",
 * "tomorrow", "this week" or two explicit dates. One resolver so the lead,
 * meeting, milestone and offer reads mean the same days by the same words.
 */
export const SYDNEY_DAY_RANGES = [
  "today",
  "tomorrow",
  "this_week",
  "next_7_days",
] as const;

export type SydneyDayRangeName = (typeof SYDNEY_DAY_RANGES)[number];

export type SydneyDayRangeInput = {
  readonly range?: SydneyDayRangeName;
  /** `YYYY-MM-DD`, inclusive. */
  readonly from?: string;
  /** `YYYY-MM-DD`, inclusive. */
  readonly to?: string;
};

export type SydneyDayRange = {
  readonly fromDay: string;
  readonly toDay: string;
  /** The first instant of `fromDay` in Sydney. */
  readonly from: Date;
  /** The last instant of `toDay` in Sydney. */
  readonly to: Date;
};

/** The longest window one read covers, so a brief cannot ask for a year. */
export const MAX_RANGE_DAYS = 62;

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
  const at = (day: string) => {
    const [year, month, date] = day.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((at(toDay) - at(fromDay)) / 86_400_000);
}

/**
 * Resolves a named or explicit window. "This week" runs from today to Sunday;
 * "next 7 days" from today to six days out. Explicit dates win over a name,
 * and a missing end is the start. Throws a `RangeError` for a window that ends
 * before it starts or is longer than `MAX_RANGE_DAYS`, which the caller turns
 * into its own refusal.
 */
export function sydneyDayRange(
  input: SydneyDayRangeInput,
  now: Date = new Date(),
): SydneyDayRange {
  const today = sydneyToday(now);
  let fromDay: string;
  let toDay: string;
  if (input.from || input.to) {
    fromDay = input.from ?? today;
    toDay = input.to ?? fromDay;
  } else {
    switch (input.range ?? "today") {
      case "today":
        fromDay = today;
        toDay = today;
        break;
      case "tomorrow":
        fromDay = addDays(today, 1);
        toDay = fromDay;
        break;
      case "this_week": {
        const [year, month, date] = today.split("-").map(Number) as [
          number,
          number,
          number,
        ];
        const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
        fromDay = today;
        toDay = addDays(today, (7 - weekday) % 7);
        break;
      }
      case "next_7_days":
        fromDay = today;
        toDay = addDays(today, 6);
        break;
    }
  }
  const span = daysBetween(fromDay, toDay);
  if (span < 0) throw new RangeError("The window ends before it starts.");
  if (span >= MAX_RANGE_DAYS) {
    throw new RangeError(`A window can cover at most ${MAX_RANGE_DAYS} days.`);
  }
  return {
    from: sydneyStartOfDay(fromDay),
    fromDay,
    to: sydneyEndOfDay(toDay),
    toDay,
  };
}
