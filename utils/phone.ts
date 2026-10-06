/**
 * An Australian phone number as people here write it, for display.
 *
 * Team phones are stored in E.164 ("+61412345678") because Clerk requires it —
 * see `teamPhoneE164` in lib/domain/identity/team.ts, which is what decides
 * whether a number is acceptable. This only changes how one reads:
 *
 *   +61412345678  → 0412 345 678     (mobile)
 *   +61298765432  → (02) 9876 5432   (landline, with its area code)
 *
 * A number that is not Australian, or not a whole one, comes back as given
 * rather than half-reformatted.
 */
export function formatAuPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  let national: string | null = null;
  if (trimmed.startsWith("+")) {
    if (/^61\d{9}$/.test(digits)) national = `0${digits.slice(2)}`;
  } else if (/^0\d{9}$/.test(digits)) {
    national = digits;
  }
  if (!national) return trimmed;

  if (/^0[2378]/.test(national)) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)} ${national.slice(6)}`;
  }
  return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
}
