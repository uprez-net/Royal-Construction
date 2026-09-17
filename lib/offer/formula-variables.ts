// Single source of truth for the variable names available in cost-schedule
// formula strings. Two distinct kinds — never conflate them:
//
//   Rate constants: prices that rarely change and are the same for every
//   offer until an admin updates them. Admin-editable in the "Rate Constants"
//   panel of the admin Cost Schedule.
//
//   Area measurements: calculated values specific to THIS project, derived
//   from the Area Calculator (Phase 1) during offer creation. ALWAYS start at
//   0 on a new offer — never admin-editable. Listed here so the formula-
//   authoring UI can show admins which tokens will be valid at offer-creation
//   time.

export const RATE_CONSTANT_KEYS = [
  "DROP_EDGE_BEAM_COST_PER_SURFACE_AREA",
  "PRICE_OF_EACH_TRUCK",
  "FRAME_GROUND_RATE_PER_SQM",
  "FRAME_FIRST_RATE_PER_SQM",
  "SAND_RATE_PER_THOUSAND_BRICKS",
  "CEMENT_RATE_PER_HUNDRED_BRICKS",
  "BRICK_PRICE_PER_BRICK",
  "BRICK_LAYING_PRICE_PER_BRICK",
  "TILE_PRICE_PER_TILE",
  "TILING_RATE_PER_SQM",
  "FLOORING_RATE_PER_SQM",
  "SLAB_COST_PER_SQM",
  "KITCHEN_COST_PER_SQM",
  "FRAME_INSTALLER_RATE_PER_SQM",
  "PRICE_OF_EACH_SHOWER",
  "PRICE_OF_EACH_WARDROBE",
  "PRICE_OF_EACH_LINEN",
] as const;

// Phase 1 calculated values (from the Area Calculator) that are available as
// tokens in cost-schedule formula strings. These are computed per-offer from
// the estimator's inputs and the rate constants above — never admin-editable.
export const AREA_MEASUREMENT_KEYS = [
  // Slab section
  "TOTAL_SLAB_COST",
  "TOTAL_DROP_EDGE_BEAM_COST",
  "TOTAL_TRUCK_PRICE",
  // Frame section
  "TOTAL_AREA",
  "TOTAL_FLOORING_AREA",
  "TOTAL_GROUND_FLOOR_FRAME_COST",
  "TOTAL_FIRST_FLOOR_FRAME_COST",
  "TOTAL_GROUND_FLOOR_AREA",
  "STEEL",
  "INSTALLER",
  "EAVES",
  // Bricks section
  "TOTAL_BRICKS_REQUIRED",
  "TOTAL_SAND_COST",
  "TOTAL_CEMENT_COST",
  "TIE_COST",
  // Tiles section
  "TOTAL_TILES_REQUIRED",
  // Kitchen section
  "KITCHEN_AREA",
  // Rooms section
  "TOTAL_SHOWERS",
  "TOTAL_BEDROOMS",
  "TOTAL_LINENS",
] as const;

export type RateConstantKey = (typeof RATE_CONSTANT_KEYS)[number];
export type AreaMeasurementKey = (typeof AREA_MEASUREMENT_KEYS)[number];

// Default seed values for rate constants. Used by the seed script and as the
// fallback when the admin has no override for a key.
export const DEFAULT_RATE_CONSTANTS: Record<RateConstantKey, number> = {
  DROP_EDGE_BEAM_COST_PER_SURFACE_AREA: 18,
  PRICE_OF_EACH_TRUCK: 500,
  FRAME_GROUND_RATE_PER_SQM: 137.5,
  FRAME_FIRST_RATE_PER_SQM: 148.5,
  SAND_RATE_PER_THOUSAND_BRICKS: 100,
  CEMENT_RATE_PER_HUNDRED_BRICKS: 15,
  BRICK_PRICE_PER_BRICK: 1.3,
  BRICK_LAYING_PRICE_PER_BRICK: 50,
  TILE_PRICE_PER_TILE: 28,
  TILING_RATE_PER_SQM: 65,
  FLOORING_RATE_PER_SQM: 60,
  SLAB_COST_PER_SQM: 200,
  KITCHEN_COST_PER_SQM: 700,
  FRAME_INSTALLER_RATE_PER_SQM: 55,
  PRICE_OF_EACH_SHOWER: 500,
  PRICE_OF_EACH_WARDROBE: 500,
  PRICE_OF_EACH_LINEN: 500,
};

// The rate constants a formula is actually priced with: stored admin overrides
// on top of the defaults, exactly as the offer prefill merges them. The admin
// editor used to validate against the stored keys alone, so a formula using a
// constant the admin had never overridden was flagged unknown and blocked Save.
export function withDefaultRateConstants(
  stored: Partial<Record<RateConstantKey, number>>,
): Record<RateConstantKey, number> {
  return { ...DEFAULT_RATE_CONSTANTS, ...stored };
}

// ─── Phase 2 line-item formulas ───
//
// The default formula strings that populate each work line item in the admin
// cost schedule. Each composes Phase 1 calculated values (AREA_MEASUREMENT_KEYS)
// with Phase 2 constants (RATE_CONSTANT_KEYS) — no magic numbers duplicated.
//
// These are the seed defaults; an admin can override any row's formula in the
// cost schedule screen. The keys map to known task names in
// OFFER_SEQUENCE_MAPPINGS so the seed script can look up the right taskKey.

export const LINE_ITEM_FORMULAS: ReadonlyArray<{
  readonly taskName: string;
  readonly formula: string;
}> = [
  {
    taskName: "Slab",
    formula: "TOTAL_SLAB_COST - TOTAL_DROP_EDGE_BEAM_COST",
  },
  {
    taskName: "Drop edge beam",
    formula: "TOTAL_DROP_EDGE_BEAM_COST",
  },
  {
    taskName: "Frame",
    formula: "TOTAL_GROUND_FLOOR_FRAME_COST + TOTAL_FIRST_FLOOR_FRAME_COST",
  },
  {
    taskName: "Steel",
    formula: "STEEL",
  },
  {
    taskName: "Installer",
    formula: "INSTALLER",
  },
  {
    taskName: "Eaves",
    formula: "EAVES",
  },
  {
    taskName: "Brick layer material with bars",
    formula: "(TOTAL_SAND_COST + TOTAL_CEMENT_COST + TIE_COST) * 1.3",
  },
  {
    taskName: "Common brick / Face brick",
    formula: "TOTAL_BRICKS_REQUIRED * BRICK_PRICE_PER_BRICK",
  },
  {
    taskName: "Brick layer",
    formula: "TOTAL_BRICKS_REQUIRED * BRICK_LAYING_PRICE_PER_BRICK",
  },
  {
    taskName: "Tiles",
    formula: "TOTAL_TILES_REQUIRED * TILE_PRICE_PER_TILE",
  },
  {
    taskName: "Tiling",
    formula: "TOTAL_GROUND_FLOOR_AREA * TILING_RATE_PER_SQM",
  },
  {
    taskName: "Flooring",
    formula: "TOTAL_GROUND_FLOOR_AREA * FLOORING_RATE_PER_SQM",
  },
];
