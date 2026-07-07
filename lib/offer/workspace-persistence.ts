import { z } from "zod";
import type {
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
  OfferDocumentDraft,
} from "./workspace-model";
import type { OfferAreaCalculator } from "./workspace-area";
import type {
  LegacyWorkbookPricingSettings,
  OfferWorkspacePricingSettings,
  RateCardProduct,
  RateCardTier,
} from "./workspace-pricing";
import type { OfferPaymentScheduleRow } from "./workspace-payment-schedule";
import type { OfferImageMap } from "./workspace-images";

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
  readonly legacyPricingSettings: LegacyWorkbookPricingSettings;
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
  clientEmail: z.string(),
  clientPhone: z.string(),
  siteAddress: z.string(),
  buildType: z.string(),
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

const workspaceStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  job: jobSchema,
  costLines: z.array(costLineSchema),
  allowances: z.array(scopeItemSchema),
  exclusions: z.array(scopeItemSchema),
  draft: draftSchema,
  areaCalculator: numberRecord,
  pricingSettings: numberRecord,
  legacyPricingSettings: numberRecord,
  paymentSchedule: z.array(paymentRowSchema),
  rateCardProduct: z.string(),
  rateCardTier: z.string(),
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
    legacyPricingSettings: { ...snapshot.legacyPricingSettings },
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
    workspacePricingSettings:
      persisted.pricingSettings as unknown as OfferWorkspacePricingSettings,
    legacyPricingSettings:
      persisted.legacyPricingSettings as unknown as LegacyWorkbookPricingSettings,
    paymentSchedule: persisted.paymentSchedule.map((row) => ({
      id: row.id,
      stageName: row.stageName,
      percentOfContract: row.percentBasisPoints / 10000,
      trigger: row.trigger,
    })),
    rateCardProduct: persisted.rateCardProduct as RateCardProduct,
    rateCardTier: persisted.rateCardTier as RateCardTier,
    overrideReason: persisted.overrideReason,
    selectedPriceInput: String(centsToDollars(persisted.selectedPriceCents)),
    standardPriceInput: String(centsToDollars(persisted.standardPriceCents)),
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
