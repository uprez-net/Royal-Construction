import { roundCurrency } from "@/lib/offer/pricing";

export const RATE_CARD_PRODUCTS = [
  { value: "SINGLE_STOREY", label: "Single storey" },
  { value: "DOUBLE_STOREY", label: "Double storey" },
  { value: "DUPLEX", label: "Duplex" },
  { value: "KDR", label: "Knock down rebuild" },
  { value: "GRANNY_FLAT", label: "Granny flat" },
] as const;

export const RATE_CARD_TIERS = [
  { value: "STANDARD", label: "Standard" },
  { value: "MID", label: "Mid" },
  { value: "PREMIUM", label: "Premium" },
] as const;

export type RateCardProduct = (typeof RATE_CARD_PRODUCTS)[number]["value"];
export type RateCardTier = (typeof RATE_CARD_TIERS)[number]["value"];

export type RateCardStatus =
  | "at_or_above_target"
  | "between_floor_and_target"
  | "below_floor";

export type RateCardComparison = {
  readonly product: RateCardProduct;
  readonly productLabel: string;
  readonly tier: RateCardTier;
  readonly tierLabel: string;
  readonly sellRatePerSqmIncGst: number;
  readonly marginFloorRatePerSqmIncGst: number;
  readonly targetContractValueIncGst: number;
  readonly floorContractValueIncGst: number;
  readonly selectedContractValueIncGst: number;
  readonly varianceToTargetIncGst: number;
  readonly varianceToFloorIncGst: number;
  readonly status: RateCardStatus;
};

type RateCardEntry = {
  readonly product: RateCardProduct;
  readonly tier: RateCardTier;
  readonly sellRatePerSqmIncGst: number;
};

const DEFAULT_RATE_CARD_ENTRY: RateCardEntry = {
  product: "DOUBLE_STOREY",
  tier: "MID",
  sellRatePerSqmIncGst: 2700,
};

const RATE_CARD_ENTRIES: readonly RateCardEntry[] = [
  { product: "SINGLE_STOREY", tier: "STANDARD", sellRatePerSqmIncGst: 2200 },
  { product: "SINGLE_STOREY", tier: "MID", sellRatePerSqmIncGst: 2550 },
  { product: "SINGLE_STOREY", tier: "PREMIUM", sellRatePerSqmIncGst: 3000 },
  { product: "DOUBLE_STOREY", tier: "STANDARD", sellRatePerSqmIncGst: 2350 },
  { product: "DOUBLE_STOREY", tier: "MID", sellRatePerSqmIncGst: 2700 },
  { product: "DOUBLE_STOREY", tier: "PREMIUM", sellRatePerSqmIncGst: 3200 },
  { product: "DUPLEX", tier: "STANDARD", sellRatePerSqmIncGst: 2400 },
  { product: "DUPLEX", tier: "MID", sellRatePerSqmIncGst: 2750 },
  { product: "DUPLEX", tier: "PREMIUM", sellRatePerSqmIncGst: 3300 },
  { product: "KDR", tier: "STANDARD", sellRatePerSqmIncGst: 2400 },
  { product: "KDR", tier: "MID", sellRatePerSqmIncGst: 2800 },
  { product: "KDR", tier: "PREMIUM", sellRatePerSqmIncGst: 3400 },
  { product: "GRANNY_FLAT", tier: "STANDARD", sellRatePerSqmIncGst: 2600 },
  { product: "GRANNY_FLAT", tier: "MID", sellRatePerSqmIncGst: 2950 },
  { product: "GRANNY_FLAT", tier: "PREMIUM", sellRatePerSqmIncGst: 3500 },
] as const;

type RateCardComparisonInput = {
  readonly product: RateCardProduct;
  readonly tier: RateCardTier;
  readonly totalAreaSqm: number;
  readonly selectedContractValueIncGst: number;
};

export function calculateRateCardComparison({
  product,
  tier,
  totalAreaSqm,
  selectedContractValueIncGst,
}: RateCardComparisonInput): RateCardComparison {
  const entry = getRateCardEntry(product, tier);
  const productLabel = getProductLabel(product);
  const tierLabel = getTierLabel(tier);
  const marginFloorRatePerSqmIncGst = roundCurrency(
    entry.sellRatePerSqmIncGst * 0.88,
  );
  const targetContractValueIncGst = roundCurrency(
    totalAreaSqm * entry.sellRatePerSqmIncGst,
  );
  const floorContractValueIncGst = roundCurrency(
    totalAreaSqm * marginFloorRatePerSqmIncGst,
  );

  return {
    product,
    productLabel,
    tier,
    tierLabel,
    sellRatePerSqmIncGst: entry.sellRatePerSqmIncGst,
    marginFloorRatePerSqmIncGst,
    targetContractValueIncGst,
    floorContractValueIncGst,
    selectedContractValueIncGst: roundCurrency(selectedContractValueIncGst),
    varianceToTargetIncGst: roundCurrency(
      selectedContractValueIncGst - targetContractValueIncGst,
    ),
    varianceToFloorIncGst: roundCurrency(
      selectedContractValueIncGst - floorContractValueIncGst,
    ),
    status: getRateCardStatus(
      selectedContractValueIncGst,
      targetContractValueIncGst,
      floorContractValueIncGst,
    ),
  };
}

function getRateCardEntry(
  product: RateCardProduct,
  tier: RateCardTier,
): RateCardEntry {
  return (
    RATE_CARD_ENTRIES.find(
      (entry) => entry.product === product && entry.tier === tier,
    ) ?? DEFAULT_RATE_CARD_ENTRY
  );
}

function getProductLabel(product: RateCardProduct): string {
  return (
    RATE_CARD_PRODUCTS.find((entry) => entry.value === product)?.label ??
    product
  );
}

function getTierLabel(tier: RateCardTier): string {
  return RATE_CARD_TIERS.find((entry) => entry.value === tier)?.label ?? tier;
}

function getRateCardStatus(
  selectedContractValueIncGst: number,
  targetContractValueIncGst: number,
  floorContractValueIncGst: number,
): RateCardStatus {
  if (selectedContractValueIncGst >= targetContractValueIncGst) {
    return "at_or_above_target";
  }

  if (selectedContractValueIncGst >= floorContractValueIncGst) {
    return "between_floor_and_target";
  }

  return "below_floor";
}
