/**
 * A trade in the tradie directory: what `Tradie.trade` holds and what every
 * trade picker lists. Kept in the `TradeType` table so an admin can add one
 * (Admin → Trade types) without a deploy.
 *
 * Pure data, no React: the domain validates `icon` against `TRADE_ICON_KEYS`
 * and must not import lucide to do it. The glyph for each key lives in
 * constants/tradieTypes.ts.
 */
export const TRADE_ICON_KEYS = [
  "zap",
  "lightbulb",
  "lamp",
  "plug",
  "cable",
  "wrench",
  "droplets",
  "shower-head",
  "bath",
  "hammer",
  "drill",
  "axe",
  "paintbrush",
  "paint-roller",
  "house",
  "warehouse",
  "fan",
  "thermometer",
  "trees",
  "leaf",
  "shovel",
  "fence",
  "brick-wall",
  "panel-top",
  "grid-3x3",
  "layout-grid",
  "square-stack",
  "blinds",
  "door-open",
  "building-2",
  "sofa",
  "ruler",
  "pencil-ruler",
  "compass",
  "construction",
  "hard-hat",
  "shield-check",
  "badge-check",
  "bug",
  "flame",
  "traffic-cone",
  "truck",
  "container",
  "recycle",
  "sun",
  "cctv",
] as const;

export type TradeIconKey = (typeof TRADE_ICON_KEYS)[number];

export function isTradeIconKey(value: string): value is TradeIconKey {
  return (TRADE_ICON_KEYS as readonly string[]).includes(value);
}

/** A trade as the pickers see it. */
export type TradeTypeOption = {
  readonly id: string;
  readonly label: string;
  readonly icon: TradeIconKey;
};

/** A trade as Admin → Trade types sees it. */
export type TradeTypeAdminRow = TradeTypeOption & {
  readonly archived: boolean;
  /** Tradies whose `trade` is this label. */
  readonly tradieCount: number;
  /**
   * Picked by name elsewhere — the Compliance tab's contact pickers — so it
   * cannot be renamed, archived or deleted. The icon can still change.
   */
  readonly locked: boolean;
};

/** The cache tag every read of the trade list carries. */
export const TRADE_TYPES_TAG = "trade-types";
