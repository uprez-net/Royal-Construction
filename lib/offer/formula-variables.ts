// Single source of truth for the variable names available in cost-schedule
// formula strings. Two distinct kinds — never conflate them:
//
//   Rate constants: prices that rarely change and are the same for every
//   offer until an admin updates them. Admin-editable in the "Rate Constants"
//   panel of the admin Cost Schedule.
//
//   Area measurements: numbers specific to THIS project, entered during the
//   new-offer creation flow (Job setup floor areas + Area Calculator lineal
//   metres / tile area). ALWAYS start at 0 on a new offer — never
//   admin-editable. Listed here so the formula-authoring UI can show admins
//   which tokens will be valid at offer-creation time.

export const RATE_CONSTANT_KEYS = [
  "SLAB_RATE_PER_SQM",
  "DROP_EDGE_RATE",
  "FRAME_GROUND_RATE_PER_SQM",
  "FRAME_FIRST_RATE_PER_SQM",
  "STEEL_ALLOWANCE",
  "FRAME_INSTALL_ALLOWANCE",
  "BRICKS_PER_SQM",
  "SAND_RATE_PER_THOUSAND_BRICKS",
  "CEMENT_RATE_PER_HUNDRED_BRICKS",
  "TILE_SUPPLY_RATE_PER_SQM",
  "TILER_RATE_PER_SQM",
  // New rate constants from the Phase 2 requirements:
  "BRICK_PRICE_PER_BRICK",
  "BRICK_LAYING_PRICE_PER_BRICK",
  "TILE_PRICE_PER_TILE",
  "TILING_RATE_PER_SQM",
  "FLOORING_RATE_PER_SQM",
] as const;

export const AREA_MEASUREMENT_KEYS = [
  "SLAB_AREA",
  "DROP_EDGE_LM",
  "GROUND_FLOOR_SQM",
  "FIRST_FLOOR_SQM",
  "TILE_AREA_SQM",
  "BRICK_GROUND_LM",
  "BRICK_FIRST_LM",
  "BRICK_GROUND_HEIGHT",
  "BRICK_FIRST_HEIGHT",
  "EXTRA_TRUCK_COST",
] as const;

export type RateConstantKey = (typeof RATE_CONSTANT_KEYS)[number];
export type AreaMeasurementKey = (typeof AREA_MEASUREMENT_KEYS)[number];

// Default seed values for rate constants — sourced from INITIAL_AREA_CALCULATOR
// (workspace-area.ts) plus the five new user-provided values. Used by the seed
// script and as the fallback when the admin has no override for a key.
export const DEFAULT_RATE_CONSTANTS: Record<RateConstantKey, number> = {
  SLAB_RATE_PER_SQM: 220,
  DROP_EDGE_RATE: 280,
  FRAME_GROUND_RATE_PER_SQM: 125,
  FRAME_FIRST_RATE_PER_SQM: 135,
  STEEL_ALLOWANCE: 10000,
  FRAME_INSTALL_ALLOWANCE: 15000,
  BRICKS_PER_SQM: 50,
  SAND_RATE_PER_THOUSAND_BRICKS: 100,
  CEMENT_RATE_PER_HUNDRED_BRICKS: 15,
  TILE_SUPPLY_RATE_PER_SQM: 30,
  TILER_RATE_PER_SQM: 70,
  // New seed values:
  BRICK_PRICE_PER_BRICK: 1.3,
  BRICK_LAYING_PRICE_PER_BRICK: 50,
  TILE_PRICE_PER_TILE: 28,
  TILING_RATE_PER_SQM: 65,
  FLOORING_RATE_PER_SQM: 60,
};