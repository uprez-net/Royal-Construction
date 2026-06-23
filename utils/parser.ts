import { differenceInCalendarDays } from "date-fns";
import { startOfDay } from "date-fns/startOfDay";

/**
 * Check whether a string is a UUID v1-5 formatted string.
 * @param str - candidate string
 * @returns true when the string matches UUID format
 */
export const isUUID = (str: string): boolean => {
    const uuidRegex =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

    return uuidRegex.test(str);
}

/**
 * Calculate the number of full calendar days from today until a target date.
 * Positive values mean the date is in the future.
 * @param value - date string or Date instance
 * @returns number of days from today until `value`
 */
export function daysUntil(value: string | Date): number {
  return differenceInCalendarDays(
    startOfDay(new Date(value)),
    startOfDay(new Date()),
  );
}