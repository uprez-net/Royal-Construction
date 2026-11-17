// How close the Xero refresh token is to expiring. One rule, read by the Xero
// page and the Admin hub, so the two never disagree. No imports: the Xero
// panel is a client component.

/** Warn while there is still time to act, rather than on the day it dies. */
export const XERO_EXPIRY_WARNING_DAYS = 14;

export type XeroExpiry = {
  /** Whole days left, rounded up; null when Xero gave no expiry. */
  daysLeft: number | null;
  state: "ok" | "expiring" | "expired";
};

export function xeroConnectionExpiry(
  refreshTokenExpiresAt: Date | string | null,
  now: Date = new Date(),
): XeroExpiry {
  const daysLeft = refreshTokenExpiresAt
    ? Math.ceil(
        (new Date(refreshTokenExpiresAt).getTime() - now.getTime())
          / 86_400_000,
      )
    : null;
  const state =
    daysLeft === null
      ? "ok"
      : daysLeft <= 0
        ? "expired"
        : daysLeft <= XERO_EXPIRY_WARNING_DAYS
          ? "expiring"
          : "ok";
  return { daysLeft, state };
}
