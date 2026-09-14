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
