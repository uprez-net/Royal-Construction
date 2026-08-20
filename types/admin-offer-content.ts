// Single source of truth for the Admin Offer Content module shapes.
// Every consumer (server page, client components, Redux slice, server
// actions, Zod schemas) imports from here — never redeclare these.

import type { RateConstantKey } from "@/lib/offer/formula-variables";

// Singleton cache tag shared by every read/write of this row, so any save
// invalidates the cached read used by the server page.
export const ADMIN_OFFER_CONTENT_TAG = "admin-offer-content";
// ---- Build Scope ----
// Array of lines that make up the default scope-of-works text block.
export type BuildScopeLines = string[];

// ---- Cost Schedule ----
export type PriceMode = "none" | "fixed" | "formula";

export interface CostScheduleRowBase {
  id: string; // stable client-side id (uuid), NOT the same as mapId
  taskKey: string; // stable slug joining admin rows to OFFER_SEQUENCE_MAPPINGS
  phase: string; // admin-only display grouping (no runtime counterpart)
  task: string; // task description (maps to OfferWorkspaceCostLine.itemName)
  mapId?: number; // optional "MAP #" reference into the pricing/estimation system
  defaultInclude: boolean; // maps to the "Included" toggle
}

export type CostScheduleRow =
  | (CostScheduleRowBase & { priceMode: "none" })
  | (CostScheduleRowBase & { priceMode: "fixed"; value: number })
  | (CostScheduleRowBase & { priceMode: "formula"; formula: string });

export interface CostScheduleData {
  rows: CostScheduleRow[];
  // Admin-editable rate constants (brick price, slab rate, etc.). Seed values
  // come from DEFAULT_RATE_CONSTANTS in lib/offer/formula-variables. Project
  // measurements (SLAB_AREA, GROUND_FLOOR_SQM, ...) are NEVER stored here —
  // they're entered per-offer in Job setup / the Area Calculator.
  rateConstants: Partial<Record<RateConstantKey, number>>;
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

// Distinguishes a hard exclusion from an owner-supplied item — mirrors the
// runtime OfferWorkspaceScopeItem.category split ("exclusion" vs
// "owner_selection"), which drives which bucket an item renders under.
export type ExclusionKind = "excluded" | "owner_supplied";

export interface OfferExclusion {
  id: string;
  name: string;
  description: string;
  variationRule: string;
  exclusionKind: ExclusionKind;
}

export interface OfferScopeData {
  allowances: OfferAllowance[];
  exclusions: OfferExclusion[];
}

// ---- Offer Content ----
export interface OfferContentData {
  headline: string;
  introText: string;
  inclusions: string[]; // one-pager inclusion bullets
  termsAndConditions: string; // default T&C text
}

export interface HBFCClaimData {
  claimAmount: number; // default HBFC claim amount
  loadingChargePercent: number; // default HBFC loading charge percentage
  totalPremiumToBePaid: number; // default HBFC total premium to be paid
}

// ---- Aggregate ----
export interface AdminOfferContent {
  buildScope: BuildScopeLines;
  costSchedule: CostScheduleData;
  offerScope: OfferScopeData;
  offerContent: OfferContentData;
  hbfcClaim: HBFCClaimData;
}

export const EMPTY_ADMIN_OFFER_CONTENT: AdminOfferContent = {
  buildScope: [],
  costSchedule: { rows: [], rateConstants: {} },
  offerScope: { allowances: [], exclusions: [] },
  offerContent: {
    headline: "",
    introText: "",
    inclusions: [],
    termsAndConditions: "",
  },
  hbfcClaim: {
    claimAmount: 0,
    loadingChargePercent: 0,
    totalPremiumToBePaid: 0,
  }
};