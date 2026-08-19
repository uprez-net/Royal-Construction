import { currency } from "./formatters";

/** Standard site day, used to turn an hourly rate into a daily cost. */
export const NORMAL_WORKING_HOURS = 8;

/**
 * What a scheduled tradie costs for a stint of `durationDays`.
 *
 * `unit` is not optional by accident. `lastQuotedPrice` is a bare number, and
 * 120 is a plausible hourly rate AND a plausible price for a small job — so
 * without the unit this function silently multiplied every fixed quote by
 * eight hours a day and reported a total many times too high.
 */
export function scheduleTotalCost(
  price: number,
  durationDays: number,
  unit: "HOURLY" | "FIXED",
): number {
  return unit === "FIXED" ? price : price * NORMAL_WORKING_HOURS * durationDays;
}

/** Formatted for display. */
export const calculateScheduleTotalCost = (
  price: number,
  durationDays: number,
  unit: "HOURLY" | "FIXED",
): string => currency.format(scheduleTotalCost(price, durationDays, unit));

/**
 * A quoted price with its basis, e.g. "$120.00/hr" or "$4,800.00 fixed".
 *
 * One formatter because the "/hr" suffix was previously hardcoded at five
 * separate display sites. Recording the unit is pointless if the screen still
 * says per-hour regardless.
 */
export function formatQuotedPrice(
  amount: number,
  unit: "HOURLY" | "FIXED",
  format: (value: number) => string,
): string {
  return unit === "FIXED" ? `${format(amount)} fixed` : `${format(amount)}/hr`;
}
