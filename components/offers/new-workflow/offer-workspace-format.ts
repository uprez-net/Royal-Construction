import type { MarginStatus } from "@/lib/offer/workspace-pricing";

export function formatCurrency(
  value: number | null,
  options: { readonly maximumFractionDigits?: number } = {},
): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
  }).format(value);
}

// A money delta keeps its cents whenever it has any. The send gate compares
// prices to the cent, so a 37-cent override blocks Send and must not print as
// "$0" — and a $1.50 one must not print as "+$2", which overstates the very
// difference this chip reports. Whole-dollar deltas stay unadorned: "-$50,000"
// reads better than "-$50,000.00" beside the hero figure.
export function moneyDeltaFractionDigits(delta: number): number {
  return Number.isInteger(delta) ? 0 : 2;
}

// A signed money delta, "+$0.37" or "-$50,000", for the override chip and the
// Variance line.
export function formatMoneyDelta(delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  return `${sign}${formatCurrency(Math.abs(delta), {
    maximumFractionDigits: moneyDeltaFractionDigits(delta),
  })}`;
}

// Value for a numeric <input>. A zero renders as an empty field (with a "0"
// placeholder) rather than a literal "0": a "0" sitting in the box collides with
// typing — the caret lands beside it and "400" becomes "4000", and any value not
// ending in zero means deleting it first. Empty round-trips safely because
// parseNonNegativeNumberInput("") === 0.
export function numberInputValue(value: number): string {
  return value === 0 ? "" : String(value);
}

// Combine the base reference and revision for display, without emitting a bare
// leading dash if the base reference is ever missing (e.g. "R1", not "-R1").
export function formatOfferReference(
  reference: string,
  revision: string,
): string {
  return reference.trim().length > 0 ? `${reference}-${revision}` : revision;
}

// Re-exported so the rail digest and the strip chip cannot drift apart.
export { formatPercent } from "@/lib/offer/format";

export function getMarginStatusLabel(status: MarginStatus): string {
  switch (status) {
    case "at_target":
      return "At target";
    case "acceptable_below_target":
      return "Acceptable";
    case "below_minimum":
      return "Below minimum";
    case "not_priced":
      return "Not priced";
  }
}
