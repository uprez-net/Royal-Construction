export const DEFAULT_GST_RATE = 0.1;

export type OfferLinePricingInput = {
  unitPrice: number;
  quantity: number;
  gstRate?: number;
  gstIncluded?: boolean;
};

export type PricedOfferLine = {
  netLine: number;
  gstAmount: number;
  totalPrice: number;
};

export type OfferTotals = {
  amount: number;
  gstAmount: number;
  totalAmount: number;
};

/**
 * Round a number to two decimal places in a currency-safe way.
 * @param value - numeric value to round
 * @returns rounded number with two decimal precision
 */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate pricing for a single offer line, handling GST included or excluded prices.
 * @param param0 - input object containing unitPrice, quantity, gstRate and gstIncluded
 * @returns priced offer line with netLine, gstAmount and totalPrice
 */
export function calculateOfferLinePricing({
  unitPrice,
  quantity,
  gstRate = DEFAULT_GST_RATE,
  gstIncluded = true,
}: OfferLinePricingInput): PricedOfferLine {
  const rawLine = unitPrice * quantity;

  if (gstIncluded) {
    const netLine = roundCurrency(rawLine / (1 + gstRate));
    const gstAmount = roundCurrency(rawLine - netLine);

    return {
      netLine,
      gstAmount,
      totalPrice: roundCurrency(rawLine),
    };
  }

  const netLine = roundCurrency(rawLine);
  const gstAmount = roundCurrency(netLine * gstRate);

  return {
    netLine,
    gstAmount,
    totalPrice: roundCurrency(netLine + gstAmount),
  };
}

/**
 * Reconstruct a priced line when only the stored total price is available.
 * Assumes the stored total includes GST.
 * @param totalPrice - stored total price
 * @param gstRate - GST rate to assume
 * @returns priced offer line for the provided total
 */
export function hydratePricingFromStoredTotal(
  totalPrice: number,
  gstRate = DEFAULT_GST_RATE,
): PricedOfferLine {
  return calculateOfferLinePricing({
    unitPrice: totalPrice,
    quantity: 1,
    gstRate,
    gstIncluded: true,
  });
}

/**
 * Sum an array of priced offer lines to derive totals.
 * @param lines - array of priced offer lines
 * @returns aggregated totals including net amount, gst amount and total amount
 */
export function calculateOfferTotals(lines: PricedOfferLine[]): OfferTotals {
  return {
    amount: roundCurrency(lines.reduce((sum, line) => sum + line.netLine, 0)),
    gstAmount: roundCurrency(lines.reduce((sum, line) => sum + line.gstAmount, 0)),
    totalAmount: roundCurrency(lines.reduce((sum, line) => sum + line.totalPrice, 0)),
  };
}

