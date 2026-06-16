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

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

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

export function calculateOfferTotals(lines: PricedOfferLine[]): OfferTotals {
  return {
    amount: roundCurrency(lines.reduce((sum, line) => sum + line.netLine, 0)),
    gstAmount: roundCurrency(lines.reduce((sum, line) => sum + line.gstAmount, 0)),
    totalAmount: roundCurrency(lines.reduce((sum, line) => sum + line.totalPrice, 0)),
  };
}

