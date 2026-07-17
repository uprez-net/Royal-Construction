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

// Combine the base reference and revision for display, without emitting a bare
// leading dash if the base reference is ever missing (e.g. "R1", not "-R1").
export function formatOfferReference(
  reference: string,
  revision: string,
): string {
  return reference.trim().length > 0 ? `${reference}-${revision}` : revision;
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function getMarginStatusLabel(status: MarginStatus): string {
  switch (status) {
    case "at_target":
      return "At target";
    case "acceptable_below_target":
      return "Acceptable";
    case "below_minimum":
      return "Below minimum";
  }
}
