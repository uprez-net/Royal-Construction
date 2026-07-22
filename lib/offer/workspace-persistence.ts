import { z } from "zod";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
  type OfferDocumentDraft,
} from "./workspace-model";
import type { OfferAreaCalculator } from "./workspace-area";
import type {
  OfferWorkspacePricingSettings,
  RateCardProduct,
  RateCardTier,
} from "./workspace-pricing";
import type { OfferPaymentScheduleRow } from "./workspace-payment-schedule";
import type { OfferImageMap } from "./workspace-images";
import {
  RATE_CARD_PRODUCTS,
  RATE_CARD_TIERS,
} from "./workspace-rate-card";

// The bundle of workspace state we persist (everything except transient status
// and the ephemeral import result). Mirrors the container's useState set.
export type OfferWorkspaceSnapshot = {
  readonly job: OfferWorkspaceJob;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly draft: OfferDocumentDraft;
  readonly areaCalculator: OfferAreaCalculator;
  readonly workspacePricingSettings: OfferWorkspacePricingSettings;
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly rateCardProduct: RateCardProduct;
  readonly rateCardTier: RateCardTier;
  readonly overrideReason: string;
  readonly selectedPriceInput: string;
  readonly standardPriceInput: string;
  readonly priceAdjustmentLabel: string;
  readonly images: OfferImageMap;
};

export const CURRENT_WORKSPACE_SCHEMA_VERSION = 1 as const;

// ─── Money helpers (ADR 0002: money persisted as integer cents) ───
export const dollarsToCents = (value: number): number =>
  Math.round(value * 100);
export const centsToDollars = (cents: number): number => cents / 100;

// An un-entered optional price (selected / standard) persists as 0 cents.
// Rehydrate it as an EMPTY field rather than the literal "0": a zero sitting in
// the box collides with typing — the caret lands beside it, so "400" becomes
// "4000", and any value not ending in zero means deleting it first. Blank and 0
// already mean the same thing to resolveOptionalPriceInput, so this is a display
// concern only; normalising here (rather than in the component) also keeps the
// hydrated state identical to the saved snapshot, so no phantom autosave fires.
function optionalPriceInput(cents: number): string {
  return cents === 0 ? "" : String(centsToDollars(cents));
}

// Rebuild the pricing settings from a persisted number-map, tolerant of both the
// current shape and the pre-rework shape. New-shape offers already carry the
// right keys; older offers kept the fee and additions on the retired
// legacyPricingSettings, so we migrate those forward. Unknown/stale keys are
// ignored and any missing key falls back to the default.
function hydratePricingSettings(
  pricing: Record<string, number>,
  legacy: Record<string, number> | undefined,
): OfferWorkspacePricingSettings {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const pick = (...vals: (number | undefined)[]) =>
    vals.find((v) => v !== undefined);
  const l = legacy ?? {};
  const d = DEFAULT_WORKSPACE_PRICING_SETTINGS;

  // Guard against a corrupt persisted fee (a legacy import once stored 2 = 200%,
  // which would triple an un-overridden price). Anything outside 0–100% is
  // clearly bad data — fall back to the default rather than propagate it.
  const feeRaw = pick(
    num(pricing.royalConstructionFeePct),
    num(l.royalConstructionFeePct),
  );
  const royalConstructionFeePct =
    feeRaw !== undefined && feeRaw >= 0 && feeRaw <= 1
      ? feeRaw
      : d.royalConstructionFeePct;

  // Overhead is new in #115. Three cases:
  //  - key ABSENT (num() → undefined) → 0: a legacy offer that predates the
  //    field keeps its original single-fee markup instead of silently gaining
  //    10%. New offers always persist an in-range key, so they never hit this.
  //  - present & in 0..1 → use it.
  //  - present but OUT OF RANGE (corrupt, e.g. a fat-fingered 2) → the default,
  //    mirroring the fee clamp — NOT 0, so a real overhead is never zeroed.
  const overheadRaw = num(pricing.royalConstructionOverheadPct);
  const royalConstructionOverheadPct =
    overheadRaw === undefined
      ? 0
      : overheadRaw >= 0 && overheadRaw <= 1
        ? overheadRaw
        : d.royalConstructionOverheadPct;

  return {
    royalConstructionOverheadPct,
    royalConstructionFeePct,
    gstRate: pick(num(pricing.gstRate)) ?? d.gstRate,
    homeWarrantyHbcfFixed:
      pick(num(pricing.homeWarrantyHbcfFixed), num(l.hbcfInsuranceFixed)) ??
      d.homeWarrantyHbcfFixed,
    impactFeeFixed: pick(num(pricing.impactFeeFixed)) ?? d.impactFeeFixed,
  };
}
const parseDollarInput = (input: string): number => {
  const parsed = Number(input.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

// ─── Persisted (JSON) schema — money in cents, percentages in basis points ───
const moneyCents = z.number().int();

const jobSchema = z.object({
  reference: z.string(),
  revision: z.string(),
  clientNames: z.string(),
  secondaryCustomerName: z.string().default(""),
  clientEmail: z.string(),
  secondaryCustomerEmail: z.string().default(""),
  clientPhone: z.string(),
  siteAddress: z.string(),
  buildType: z.string(),
  facade: z.string().default(""),
  groundFloorSqm: z.number(),
  firstFloorSqm: z.number(),
  garageSqm: z.number(),
  alfrescoPorchSqm: z.number(),
  porchSqm: z.number(),
  grannyFlatSqm: z.number(),
  validUntil: z.string(),
  preparedBy: z.string(),
  lotAreaSqm: z.number().default(0),
  dpNumber: z.string().default(""),
  zoning: z.string().default(""),
  buildScope: z.array(z.string()).default([]),
});

const costLineSchema = z.object({
  id: z.string(),
  stageCode: z.string(),
  itemName: z.string(),
  buildingSequenceTasks: z.array(z.string()),
  offerTenderLineItem: z.string(),
  tradeOrVendor: z.string(),
  notesOrSpec: z.string(),
  costExGstCents: moneyCents,
  includedInContract: z.boolean(),
  sourceReference: z.string().optional(),
});

const scopeItemSchema = z.object({
  id: z.string(),
  category: z.string(),
  amountType: z.string(),
  label: z.string(),
  description: z.string(),
  amountCents: moneyCents,
  unit: z.string(),
  variationRule: z.string(),
  includedInOfferDocument: z.boolean(),
});

const draftSchema = z.object({
  headline: z.string(),
  introText: z.string(),
  inclusionBullets: z.array(z.string()),
  exclusionBullets: z.array(z.string()),
  termsSummary: z.string(),
});

const paymentRowSchema = z.object({
  id: z.string(),
  stageName: z.string(),
  percentBasisPoints: z.number().int(), // 500 = 5%
  trigger: z.string(),
});

// Estimator config/rates (flat number maps). Kept as numbers — they are inputs
// to a recomputation, not stored contract money; the contract value of record
// is the Offer.contractValueIncGst Decimal column.
const numberRecord = z.record(z.string(), z.number());

// Validate the persisted rate-card product/tier against the known catalogue and
// coerce an unknown/corrupted value to the default entry (Double storey · Mid)
// — the same fallback the rate calc uses — so the displayed product label and
// the applied $/sqm rate can never diverge.
const rateCardProductSchema = z
  .enum(
    RATE_CARD_PRODUCTS.map((entry) => entry.value) as [
      RateCardProduct,
      ...RateCardProduct[],
    ],
  )
  .catch("DOUBLE_STOREY");
const rateCardTierSchema = z
  .enum(
    RATE_CARD_TIERS.map((entry) => entry.value) as [
      RateCardTier,
      ...RateCardTier[],
    ],
  )
  .catch("MID");

const workspaceStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  job: jobSchema,
  costLines: z.array(costLineSchema),
  allowances: z.array(scopeItemSchema),
  exclusions: z.array(scopeItemSchema),
  draft: draftSchema,
  areaCalculator: numberRecord,
  pricingSettings: numberRecord,
  // Retired but kept optional so older offers (which stored it) still parse.
  legacyPricingSettings: numberRecord.optional().default({}),
  paymentSchedule: z.array(paymentRowSchema),
  rateCardProduct: rateCardProductSchema,
  rateCardTier: rateCardTierSchema,
  overrideReason: z.string(),
  priceAdjustmentLabel: z.string(),
  selectedPriceCents: moneyCents,
  standardPriceCents: moneyCents,
  images: z.preprocess(
    coerceImages,
    z.record(
      z.string(),
      z.object({
        url: z.string(),
        source: z.enum(["upload", "dropbox", "ai"]).default("upload"),
      }),
    ),
  ),
});

// Coerce persisted image values to the {url, source} shape. Older offers stored
// a bare URL string per slot; upgrade those to source "upload" on read.
function coerceImages(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      out[key] = { url: entry, source: "upload" };
    } else if (entry && typeof entry === "object" && "url" in entry) {
      out[key] = entry;
    }
  }
  return out;
}

export type PersistedOfferWorkspaceState = z.infer<
  typeof workspaceStateV1Schema
>;

// ─── Migrate-on-read: upgrade older shapes to the current version ───
export function migrateWorkspaceState(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) {
    return raw;
  }
  const version = (raw as { schemaVersion?: number }).schemaVersion ?? 1;
  // v1 is current. Future migrations chain here: if (version < 2) { ...; version = 2 }
  void version;
  return raw;
}

export function parseWorkspaceState(
  json: unknown,
): PersistedOfferWorkspaceState {
  return workspaceStateV1Schema.parse(migrateWorkspaceState(json));
}

// ─── Serialize in-memory snapshot → persisted (cents) ───
export function serializeWorkspace(
  snapshot: OfferWorkspaceSnapshot,
): PersistedOfferWorkspaceState {
  return {
    schemaVersion: CURRENT_WORKSPACE_SCHEMA_VERSION,
    job: { ...snapshot.job, buildScope: [...snapshot.job.buildScope] },
    costLines: snapshot.lines.map((line) => ({
      id: line.id,
      stageCode: line.stageCode,
      itemName: line.itemName,
      buildingSequenceTasks: [...line.buildingSequenceTasks],
      offerTenderLineItem: line.offerTenderLineItem,
      tradeOrVendor: line.tradeOrVendor,
      notesOrSpec: line.notesOrSpec,
      costExGstCents: dollarsToCents(line.costExGst),
      includedInContract: line.includedInContract,
      ...(line.sourceReference !== undefined
        ? { sourceReference: line.sourceReference }
        : {}),
    })),
    allowances: snapshot.allowances.map(serializeScopeItem),
    exclusions: snapshot.exclusions.map(serializeScopeItem),
    draft: {
      headline: snapshot.draft.headline,
      introText: snapshot.draft.introText,
      inclusionBullets: [...snapshot.draft.inclusionBullets],
      exclusionBullets: [...snapshot.draft.exclusionBullets],
      termsSummary: snapshot.draft.termsSummary,
    },
    areaCalculator: { ...snapshot.areaCalculator },
    pricingSettings: { ...snapshot.workspacePricingSettings },
    legacyPricingSettings: {},
    paymentSchedule: snapshot.paymentSchedule.map((row) => ({
      id: row.id,
      stageName: row.stageName,
      percentBasisPoints: Math.round(row.percentOfContract * 10000),
      trigger: row.trigger,
    })),
    rateCardProduct: snapshot.rateCardProduct,
    rateCardTier: snapshot.rateCardTier,
    overrideReason: snapshot.overrideReason,
    priceAdjustmentLabel: snapshot.priceAdjustmentLabel,
    selectedPriceCents: dollarsToCents(
      parseDollarInput(snapshot.selectedPriceInput),
    ),
    standardPriceCents: dollarsToCents(
      parseDollarInput(snapshot.standardPriceInput),
    ),
    images: { ...snapshot.images },
  };
}

function serializeScopeItem(item: OfferWorkspaceScopeItem) {
  return {
    id: item.id,
    category: item.category,
    amountType: item.amountType,
    label: item.label,
    description: item.description,
    amountCents: dollarsToCents(item.amount),
    unit: item.unit,
    variationRule: item.variationRule,
    includedInOfferDocument: item.includedInOfferDocument,
  };
}

// ─── Deserialize persisted (cents) → in-memory snapshot (dollars) ───
export function deserializeWorkspace(
  persisted: PersistedOfferWorkspaceState,
): OfferWorkspaceSnapshot {
  return {
    job: persisted.job,
    lines: persisted.costLines.map((line) => ({
      id: line.id,
      stageCode: line.stageCode as OfferWorkspaceCostLine["stageCode"],
      itemName: line.itemName,
      buildingSequenceTasks: line.buildingSequenceTasks,
      offerTenderLineItem: line.offerTenderLineItem,
      tradeOrVendor: line.tradeOrVendor,
      notesOrSpec: line.notesOrSpec,
      costExGst: centsToDollars(line.costExGstCents),
      includedInContract: line.includedInContract,
      sourceReference: line.sourceReference,
    })),
    allowances: persisted.allowances.map(deserializeScopeItem),
    exclusions: persisted.exclusions.map(deserializeScopeItem),
    draft: persisted.draft,
    areaCalculator: persisted.areaCalculator as unknown as OfferAreaCalculator,
    workspacePricingSettings: hydratePricingSettings(
      persisted.pricingSettings,
      persisted.legacyPricingSettings,
    ),
    paymentSchedule: persisted.paymentSchedule.map((row) => ({
      id: row.id,
      stageName: row.stageName,
      percentOfContract: row.percentBasisPoints / 10000,
      trigger: row.trigger,
    })),
    rateCardProduct: persisted.rateCardProduct,
    rateCardTier: persisted.rateCardTier,
    overrideReason: persisted.overrideReason,
    selectedPriceInput: optionalPriceInput(persisted.selectedPriceCents),
    standardPriceInput: optionalPriceInput(persisted.standardPriceCents),
    priceAdjustmentLabel: persisted.priceAdjustmentLabel,
    images: persisted.images as OfferImageMap,
  };
}

function deserializeScopeItem(
  item: z.infer<typeof scopeItemSchema>,
): OfferWorkspaceScopeItem {
  return {
    id: item.id,
    category: item.category as OfferWorkspaceScopeItem["category"],
    amountType: item.amountType as OfferWorkspaceScopeItem["amountType"],
    label: item.label,
    description: item.description,
    amount: centsToDollars(item.amountCents),
    unit: item.unit,
    variationRule: item.variationRule,
    includedInOfferDocument: item.includedInOfferDocument,
  };
}
