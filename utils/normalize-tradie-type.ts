import { TRADIE_TYPES } from "@/constants/tradieTypes";

const normalize = (value: string) => value.trim().toLowerCase();

export type TradieType = keyof typeof TRADIE_TYPES;

export const TRADIE_TYPE_LOOKUP = (Object.entries(TRADIE_TYPES) as [TradieType, (typeof TRADIE_TYPES)[TradieType]][]).reduce(
  (acc, [key, value]) => {
    acc[normalize(key)] = key;
    acc[normalize(value)] = key;

    return acc;
  },
  {} as Record<string, keyof typeof TRADIE_TYPES>,
);

export function convertCategoryToTradieType(
  category: string,
): keyof typeof TRADIE_TYPES | null {
  return TRADIE_TYPE_LOOKUP[normalize(category)] ?? null;
}