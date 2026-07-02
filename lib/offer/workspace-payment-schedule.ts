export type OfferPaymentScheduleRow = {
  readonly id: string;
  readonly stageName: string;
  readonly percentOfContract: number;
  readonly trigger: string;
};

export const INITIAL_PAYMENT_SCHEDULE: readonly OfferPaymentScheduleRow[] = [
  {
    id: "payment-deposit",
    stageName: "Deposit",
    percentOfContract: 0.05,
    trigger: "On signing of MBA Contract",
  },
  {
    id: "payment-foundation",
    stageName: "Foundation",
    percentOfContract: 0.15,
    trigger: "Slab complete",
  },
  {
    id: "payment-frame",
    stageName: "Frame",
    percentOfContract: 0.25,
    trigger: "Frame complete and inspected",
  },
  {
    id: "payment-lockup",
    stageName: "Lock-up",
    percentOfContract: 0.25,
    trigger: "Windows, doors and roofing complete",
  },
  {
    id: "payment-interior-fitout",
    stageName: "Interior fit-out",
    percentOfContract: 0.2,
    trigger: "Internal linings, kitchen and flooring in",
  },
  {
    id: "payment-handover",
    stageName: "Handover",
    percentOfContract: 0.1,
    trigger: "Keys to client",
  },
] as const;

export function getPaymentScheduleTotalPct(
  rows: readonly OfferPaymentScheduleRow[],
): number {
  return Math.round(
    rows.reduce((sum, row) => sum + row.percentOfContract, 0) * 10000,
  ) / 10000;
}
