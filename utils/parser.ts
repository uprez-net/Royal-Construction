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

/**
 * Parses a currency-formatted string into a numeric value.
 *
 * Removes all non-numeric characters except the decimal point before
 * attempting to parse the value. Returns `undefined` if the resulting
 * value is not a valid number.
 *
 * @param value - The currency string to parse (e.g. "$1,234.56", "₹500", "1000").
 * @returns The parsed numeric value, or `undefined` if the input cannot be parsed.
 */
export function parseCurrency(value: string): number | undefined {
  // Remove any non-numeric characters except for the decimal point
  const cleanedValue = value.replace(/[^0-9.]/g, "");
  const parsedValue = parseFloat(cleanedValue);
  return isNaN(parsedValue) ? undefined : parsedValue;
}