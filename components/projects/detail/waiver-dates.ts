/**
 * The dates a waiver from the activity dialog submits.
 *
 * The dialog shows no date fields for "Not required", but keeps whatever dates
 * the activity already holds, and the domain refuses a waiver whose completion
 * date is after today in Sydney or before its start date. A stored future
 * completion date is pulled back to Sydney today, and a start date after that
 * completion date is pulled back to it, so the person is never stuck on a
 * date they cannot see. A date cleared in the picker (`""`) is sent as unset
 * rather than failing validation on a hidden field. Dates are `yyyy-MM-dd`, so
 * they compare as strings.
 */
export function waiverDates<
  T extends { status?: string; startDate?: string; actualDate?: string },
>(data: T, sydneyToday: string): T {
  if (data.status !== "NOT_REQUIRED") return data;
  const storedActual = data.actualDate || undefined;
  const storedStart = data.startDate || undefined;
  const actualDate =
    storedActual && storedActual > sydneyToday ? sydneyToday : storedActual;
  const startDate =
    actualDate && storedStart && storedStart > actualDate
      ? actualDate
      : storedStart;
  return actualDate === data.actualDate && startDate === data.startDate
    ? data
    : { ...data, actualDate, startDate };
}
