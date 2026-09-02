/**
 * Parse a date off a Xero API response.
 *
 * Xero is inconsistent about date encoding: the Accounting API returns plain
 * "YYYY-MM-DD" on some invoice fields and the legacy .NET
 * "/Date(1642636800000+0000)/" form on others, sometimes for the same logical
 * field on different endpoints. Feeding the legacy form straight to `new Date()`
 * yields Invalid Date, which silently becomes a null due-date, so both shapes
 * are handled here and anything unparseable comes back as null rather than as a
 * broken Date.
 */
export function parseXeroDate(value: string | undefined | null): Date | null {
  if (!value) {
    return null;
  }

  const legacy = value.match(/\/Date\((-?\d+)/);
  const parsed = legacy ? new Date(Number(legacy[1])) : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
