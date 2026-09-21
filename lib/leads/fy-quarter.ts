/**
 * Australian financial-year quarter arithmetic, in Sydney local time.
 *
 * FY2027 runs 1 Jul 2026 - 30 Jun 2027.
 *   Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, Q4 Apr-Jun.
 *
 * All bounds are HALF-OPEN instants: [start, endExclusive). This is why there
 * is no month-length table anywhere in this file, and why a deal closing at
 * any time on a quarter's last local day is correctly inside it.
 */

export const BUSINESS_TZ = "Australia/Sydney";

export type FyQuarter = 1 | 2 | 3 | 4;

export interface FyQuarterRef {
  fy: number;
  quarter: FyQuarter;
}

export interface FyQuarterBounds {
  start: Date;
  endExclusive: Date;
  label: string;
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The Sydney wall-clock reading at a given instant. */
function wallClockAt(instant: Date): WallClock {
  const parts = PARTS.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Intl can emit hour 24 for midnight under hour12:false.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Sydney's UTC offset, in ms, at a given instant. */
function offsetMsAt(instant: Date): number {
  const wc = wallClockAt(instant);
  const asIfUtc = Date.UTC(
    wc.year,
    wc.month - 1,
    wc.day,
    wc.hour,
    wc.minute,
    wc.second,
  );
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which Sydney's wall clock reads midnight on the given date.
 * Two-pass because the offset itself depends on the instant we are solving
 * for — the first guess can land on the wrong side of a DST transition.
 */
function sydneyMidnight(year: number, month: number, day: number): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = naiveUtc - offsetMsAt(new Date(naiveUtc));
  const secondPass = naiveUtc - offsetMsAt(new Date(firstPass));
  return new Date(secondPass);
}

/** Calendar year and month (1-12) on which a given FY quarter begins. */
function quarterStartMonth(
  fy: number,
  quarter: FyQuarter,
): { year: number; month: number } {
  switch (quarter) {
    case 1:
      return { year: fy - 1, month: 7 };
    case 2:
      return { year: fy - 1, month: 10 };
    case 3:
      return { year: fy, month: 1 };
    case 4:
      return { year: fy, month: 4 };
  }
}

export function formatFyQuarter(fy: number, quarter: FyQuarter): string {
  return `FY${fy} Q${quarter}`;
}

export function fyQuarterBounds(
  fy: number,
  quarter: FyQuarter,
): FyQuarterBounds {
  const from = quarterStartMonth(fy, quarter);
  const next =
    quarter === 4
      ? quarterStartMonth(fy + 1, 1)
      : quarterStartMonth(fy, (quarter + 1) as FyQuarter);

  return {
    start: sydneyMidnight(from.year, from.month, 1),
    endExclusive: sydneyMidnight(next.year, next.month, 1),
    label: formatFyQuarter(fy, quarter),
  };
}

/** Which FY quarter an instant falls in, judged by Sydney local time. */
export function fyQuarterOf(instant: Date): FyQuarterRef {
  const { year, month } = wallClockAt(instant);
  if (month >= 7 && month <= 9) return { fy: year + 1, quarter: 1 };
  if (month >= 10) return { fy: year + 1, quarter: 2 };
  if (month <= 3) return { fy: year, quarter: 3 };
  return { fy: year, quarter: 4 };
}
