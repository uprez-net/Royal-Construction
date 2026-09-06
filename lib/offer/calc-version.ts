// Which set of calculation RULES an offer was priced under. An offer keeps the
// version it was minted with forever, so a rule we correct today can never move
// a quote a customer already holds. New offers get CURRENT_CALC_VERSION.
//
// v1 — everything minted before the pin existed. The first-floor frame area is
//      firstFloorSqm + balconySqm; voidSqm is in no frame calculation.
// v2 — voidSqm joins the first-floor frame area, and the granny-flat area is
//      coupled to the hasGrannyHome toggle instead of drifting apart from it.
//
// Its own module rather than living in workspace-persistence: a calculation
// concept had no business in the persistence layer, and workspace-area.ts
// importing it from there closed an import cycle (persistence already imports
// INITIAL_AREA_CALCULATOR from workspace-area).
//
// CURRENT_CALC_VERSION may be ASSIGNED to an offer in exactly two places: the
// server-side pin in lib/data/offer-workspace.ts, and the fresh-offer client
// seed in new-offer-workspace.tsx. Comparing against it is fine and expected; a
// third assignment is a bug, because it would let something other than the mint
// decide an offer's rules.
//
// A revision of an old offer keeps the old rules: createOfferRevision copies
// workspaceState verbatim, so the stored pin rides along. That is deliberate —
// R4 of a 2025 offer prices on 2025 rules.

export type CalcVersion = 1 | 2;
export const LEGACY_CALC_VERSION = 1 as const;
export const CURRENT_CALC_VERSION = 2 as const;

// A stored version this build knows how to price.
//
// The persisted field is open-ended and the in-memory one is a plain number,
// both on purpose: a row written by a FUTURE build must still parse (a hard
// .parse() that threw would make the offer unopenable), and it must NOT be
// quietly rewritten to a version we do understand. So an unrecognised version
// survives intact and is instead refused at the point of calculation — see
// calculateFrame, and the guards on the reprice-on-open path.
export function isSupportedCalcVersion(value: number): value is CalcVersion {
  return value === LEGACY_CALC_VERSION || value === CURRENT_CALC_VERSION;
}
