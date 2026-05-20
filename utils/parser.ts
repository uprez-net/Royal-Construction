import { differenceInCalendarDays } from "date-fns";
import { startOfDay } from "date-fns/startOfDay";

export const isUUID = (str: string): boolean => {
    const uuidRegex =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

    return uuidRegex.test(str);
}

export function daysUntil(value: string | Date): number {
  return differenceInCalendarDays(
    startOfDay(new Date(value)),
    startOfDay(new Date()),
  );
}