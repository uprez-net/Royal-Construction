// Single source of truth for the Admin Offer Content module shapes.
// Every consumer (server page, client components, Redux slice, server
// actions, Zod schemas) imports from here — never redeclare these.

// ---- Build Scope ----
// Array of lines that make up the default scope-of-works text block.
export type BuildScopeLines = string[];

// ---- Cost Schedule ----
export type PriceMode = "none" | "fixed" | "formula";

export interface CostScheduleRowBase {
  id: string; // stable client-side id (uuid), NOT the same as mapId
  phase: string; // e.g. "GENERAL REQUIREMENTS"
  task: string; // task description
  mapId?: number; // optional "MAP #" reference into the pricing/estimation system
  defaultInclude: boolean; // maps to the "Included" toggle
}

export type CostScheduleRow =
  | (CostScheduleRowBase & { priceMode: "none" })
  | (CostScheduleRowBase & { priceMode: "fixed"; value: number })
  | (CostScheduleRowBase & { priceMode: "formula"; formula: string });

export interface CostScheduleData {
  rows: CostScheduleRow[];
  formulaVariables: Record<string, number>; // e.g. { SLAB_AREA: 325, DROP_EDGE_LM: 104, ... }
}

// ---- Offer Scope ----
export type AllowanceCategory = "package" | "per-sqm" | "per-lm" | "note-only";

export interface OfferAllowance {
  id: string;
  name: string;
  category: AllowanceCategory;
  amount: number;
  variationRule: string;
}

export interface OfferExclusion {
  id: string;
  name: string;
  description: string;
  variationRule: string;
}

export interface OfferScopeData {
  allowances: OfferAllowance[];
  exclusions: OfferExclusion[];
}

// ---- Offer Content ----
export interface OfferContentData {
  inclusions: string[]; // one-pager inclusion bullets
  termsAndConditions: string; // default T&C text
}

// ---- Aggregate ----
export interface AdminOfferContent {
  buildScope: BuildScopeLines;
  costSchedule: CostScheduleData;
  offerScope: OfferScopeData;
  offerContent: OfferContentData;
}

export const EMPTY_ADMIN_OFFER_CONTENT: AdminOfferContent = {
  buildScope: [],
  costSchedule: { rows: [], formulaVariables: {} },
  offerScope: { allowances: [], exclusions: [] },
  offerContent: { inclusions: [], termsAndConditions: "" },
};
