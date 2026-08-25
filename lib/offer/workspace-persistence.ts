import { z } from "zod";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  ownersFromLegacyClientFields,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
  type OfferDocumentDraft,
} from "./workspace-model";
import { INITIAL_AREA_CALCULATOR, type OfferAreaCalculator } from "./workspace-area";
import {
  withDerivedHbcfPremium,
  reverseHbcfTotalContractValue,
  type OfferWorkspacePricingSettings,
  type RateCardProduct,
  type RateCardTier,
} from "./workspace-pricing";
import type { OfferPaymentScheduleRow } from "./workspace-payment-schedule";
import type { OfferImageMap } from "./workspace-images";
import {
  RATE_CARD_PRODUCTS,
  RATE_CARD_TIERS,
} from "./workspace-rate-card";
import { STANDARD_INCLUSION_ENTRIES } from "./workspace-proposal-content";

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
  // Step 7 — Tender access gate (Option B: UI-only, layered on the AGREED
  // status). Persisted in the snapshot so a refresh resumes mid-gate without
  // re-asking answered questions or re-unlocking a blocked state.
  readonly tenderGate: TenderGateState;
  // The AdminOfferContent.version whose defaults produced this offer's
  // admin-derived fields (cost lines, allowances, exclusions, draft copy).
  // Compared against the live admin version when the offer is OPENED: a
  // still-editable offer re-applies the current defaults and re-stamps this;
  // an agreed/sent offer keeps its frozen snapshot. 0 means "built before
  // versioning existed", which reads as stale against any real version.
  readonly adminContentVersion: number;
};

// Architectural-plan file reference captured at the Tender access gate. Only
// the identifying fields the workspace needs to show a success confirmation
// are persisted — the file itself lives in the File table, linked to the lead
// via UploadButton's leadId metadata so it carries forward at project handoff.
export type TenderGateArchitecturalPlanFile = {
  readonly fileId: string;
  readonly fileName: string;
  readonly fileSize: number;
};

export type TenderGateState = {
  // null = Q1 unanswered.
  readonly needsArchitecturalPlan: boolean | null;
  readonly architecturalPlanFeeCollected: boolean;
  readonly architecturalPlanUploaded: TenderGateArchitecturalPlanFile | null;
  // null = Q3 unanswered (only reachable once a plan is uploaded).
  readonly architecturalPlanDesignChanges: boolean | null;
};

// Derived, not persisted — recomputed from the flags above so the cached
// status can never drift from the answers that produce it.
export type TenderGateStatus =
  | "unanswered"
  | "unlocked"
  | "pending-fee"
  | "pending-upload"
  | "pending-design-check"
  | "blocked-revision";

export const INITIAL_TENDER_GATE: TenderGateState = {
  needsArchitecturalPlan: null,
  architecturalPlanFeeCollected: false,
  architecturalPlanUploaded: null,
  architecturalPlanDesignChanges: null,
};

export function deriveTenderGateStatus(
  gate: TenderGateState,
): TenderGateStatus {
  if (gate.needsArchitecturalPlan === null) return "unanswered";
  if (gate.needsArchitecturalPlan === false) return "unlocked";
  if (!gate.architecturalPlanFeeCollected) return "pending-fee";
  if (gate.architecturalPlanUploaded === null) return "pending-upload";
  if (gate.architecturalPlanDesignChanges === null)
    return "pending-design-check";
  if (gate.architecturalPlanDesignChanges === true) return "blocked-revision";
  return "unlocked";
}

// v6 (this version): the selling list moves off the schedule rows into
// draft.inclusionHighlights. See migrateV5ToV6.
export const CURRENT_WORKSPACE_SCHEMA_VERSION = 6 as const;

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

  const hbcfTotalContractValueRaw =
    pick(num(pricing.hbcfTotalContractValue)) ?? d.hbcfTotalContractValue;
  const hbcfRate = (() => {
    const rateRaw = num(pricing.hbcfRate);
    if (rateRaw === undefined) return d.hbcfRate;
    return rateRaw >= 0 && rateRaw <= 1 ? rateRaw : d.hbcfRate;
  })();
  const homeWarrantyHbcfFixed =
    pick(num(pricing.homeWarrantyHbcfFixed), num(l.hbcfInsuranceFixed)) ??
    d.homeWarrantyHbcfFixed;

  // Whole-number percent (5 = 5%). Absent on offers saved before the loading
  // charge shipped → 0, so their premium stays exactly what was quoted. Out of
  // 0–100 is corrupt data; fall back to the default rather than propagate it.
  const loadingChargePercentage = (() => {
    const raw = num(pricing.loadingChargePercentage);
    if (raw === undefined) return 0;
    return raw >= 0 && raw <= 100 ? raw : d.loadingChargePercentage;
  })();

  const base = {
    royalConstructionOverheadPct,
    royalConstructionFeePct,
    gstRate: pick(num(pricing.gstRate)) ?? d.gstRate,
    hbcfRate,
    homeWarrantyHbcfFixed,
    impactFeeFixed: pick(num(pricing.impactFeeFixed)) ?? d.impactFeeFixed,
    loadingChargePercentage,
  };

  // Explicit TCV (post-#116) → derive the premium from it. Legacy offers that
  // only stored the dollar premium keep that exact figure and reverse-fill TCV
  // for display — re-deriving would introduce cent-level drift vs the figure
  // already shown on the saved document/timeline.
  if (hbcfTotalContractValueRaw > 0) {
    return withDerivedHbcfPremium({
      ...base,
      hbcfTotalContractValue: hbcfTotalContractValueRaw,
    });
  }

  return {
    ...base,
    hbcfTotalContractValue: reverseHbcfTotalContractValue(
      homeWarrantyHbcfFixed,
      hbcfRate,
      loadingChargePercentage,
    ),
  };
}
const parseDollarInput = (input: string): number => {
  const parsed = Number(input.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

// ─── Persisted (JSON) schema — money in cents, percentages in basis points ───
const moneyCents = z.number().int();

const ownerSignatorySchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  mobile: z.string().default(""),
  capacity: z.string().default("Owner"),
});

const ownerSchema = z.object({
  id: z.string(),
  kind: z.enum(["individual", "company"]).default("individual"),
  displayName: z.string().default(""),
  currentLocation: z.string().default(""),
  abn: z.string().default(""),
  signatories: z.array(ownerSignatorySchema).default([]),
});

const jobSchema = z.object({
  reference: z.string(),
  revision: z.string(),
  // Owner parties (ADR 0003) — source of truth. Older (v1) snapshots have no
  // owners[]; migrateWorkspaceState builds it from the flat client* fields.
  owners: z.array(ownerSchema).default([]),
  clientNames: z.string(),
  secondaryCustomerName: z.string().default(""),
  clientEmail: z.string(),
  secondaryCustomerEmail: z.string().default(""),
  clientPhone: z.string(),
  currentLocation: z.string().default(""),
  siteAddress: z.string(),
  siteCouncil: z.string().default(""),
  siteState: z.string().default(""),
  sitePostcode: z.string().default(""),
  buildType: z.string(),
  facade: z.string().default(""),
  groundFloorSqm: z.number(),
  firstFloorSqm: z.number(),
  garageSqm: z.number(),
  alfrescoPorchSqm: z.number(),
  porchSqm: z.number(),
  grannyFlatSqm: z.number(),
  balconySqm: z.number().default(0),
  voidSqm: z.number().default(0),
  kitchenSqm: z.number().default(0),
  validUntil: z.string(),
  preparedBy: z.string(),
  lotAreaSqm: z.number().default(0),
  dpNumber: z.string().default(""),
  zoning: z.string().default(""),
  buildScope: z.array(z.string()).default([]),
  bedrooms: z.number().default(0),
  bathrooms: z.number().default(0),
  garageSpaces: z.number().default(0),
  linenCount: z.number().default(0),
  // Granny home spec. Defaulted so offers persisted before the dual-spec cards
  // shipped still parse — they come back as "no granny home".
  hasGrannyHome: z.boolean().default(false),
  grannyBedrooms: z.number().default(0),
  grannyBathrooms: z.number().default(0),
  grannyGarageSpaces: z.number().default(0),
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

const inclusionEntrySchema = z.object({
  spec: z.string(),
  category: z.string().optional(),
  draftedByAi: z.boolean().optional(),
});

const draftSchema = z.object({
  headline: z.string(),
  introText: z.string(),
  exclusionBullets: z.array(z.string()),
  inclusionHighlights: z.array(z.string()).default([]),
  // Defaulted so a snapshot that somehow skips the migration still parses;
  // migrateV2ToV3 / migrateV3ToV4 are what actually seed pre-existing offers.
  inclusionSchedule: z.array(inclusionEntrySchema).default([]),
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

// Tender access gate (Step 7). Every field defaults so older snapshots (which
// predate the gate) hydrate to the initial unanswered state without a schema
// version bump or explicit migration.
const tenderGateFileSchema = z.object({
  fileId: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
});

const tenderGateSchema = z
  .object({
    needsArchitecturalPlan: z.boolean().nullable().default(null),
    architecturalPlanFeeCollected: z.boolean().default(false),
    architecturalPlanUploaded: tenderGateFileSchema.nullable().default(null),
    architecturalPlanDesignChanges: z.boolean().nullable().default(null),
  })
  .default({
    needsArchitecturalPlan: null,
    architecturalPlanFeeCollected: false,
    architecturalPlanUploaded: null,
    architecturalPlanDesignChanges: null,
  });

const workspaceStateV1Schema = z.object({
  // Derived from the constant, never re-typed: a hard-coded literal here
  // silently rejects every migrated snapshot the moment the version is bumped.
  schemaVersion: z.literal(CURRENT_WORKSPACE_SCHEMA_VERSION),
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
  tenderGate: tenderGateSchema,
  // Defaulted so every offer persisted before admin-content versioning still
  // parses; 0 sorts below any live admin version, so such an offer is treated
  // as built from unknown content and refreshed on its next editable open.
  adminContentVersion: z.number().int().nonnegative().default(0),
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
  const state = raw as Record<string, unknown>;
  const version =
    typeof state.schemaVersion === "number" ? state.schemaVersion : 1;
  let next = state;
  if (version < 2) {
    next = migrateV1ToV2(next);
  }
  if (version < 3) {
    next = migrateV2ToV3(next);
  }
  if (version < 4) {
    next = migrateV3ToV4(next);
  }
  if (version < 5) {
    next = migrateV4ToV5(next);
  }
  if (version < 6) {
    next = migrateV5ToV6(next);
  }
  return next;
}

// v1 → v2 (ADR 0003): introduce job.owners[] — the source of truth for the
// customer side — built from the flat client* fields when absent, plus the new
// currentLocation + site council/state/postcode fields. The combined primary
// name string is preserved on owner 1 (not split), so already-generated offers
// re-render identically.
function migrateV1ToV2(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const job = (state.job ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string =>
    typeof value === "string" ? value : "";
  const existingOwners = Array.isArray(job.owners) ? job.owners : [];
  const owners =
    existingOwners.length > 0
      ? existingOwners
      : ownersFromLegacyClientFields({
          clientNames: str(job.clientNames),
          secondaryCustomerName: str(job.secondaryCustomerName),
          clientEmail: str(job.clientEmail),
          secondaryCustomerEmail: str(job.secondaryCustomerEmail),
          clientPhone: str(job.clientPhone),
          currentLocation: str(job.currentLocation),
        });
  const firstOwner = owners[0] as { currentLocation?: string } | undefined;
  return {
    ...state,
    schemaVersion: 2,
    job: {
      ...job,
      owners,
      currentLocation:
        str(job.currentLocation) || (firstOwner?.currentLocation ?? ""),
      siteCouncil: str(job.siteCouncil),
      siteState: str(job.siteState),
      sitePostcode: str(job.sitePostcode),
    },
  };
}

// v2 → v3: the Inclusions Schedule moves from a hard-coded module constant to
// per-offer editable copy on the draft. Snapshots written before this change
// carry no schedule, and re-rendering one (revision viewer, re-send) must
// reproduce the document the client actually received — so they are seeded with
// the template list that WAS the schedule at the time they were written. An
// explicitly empty array is left alone: from v3 on, "no rows" is a choice the
// estimator can make, not a missing field.
function migrateV2ToV3(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  return {
    ...state,
    schemaVersion: 3,
    draft: {
      ...draft,
      inclusionSchedule: Array.isArray(draft.inclusionSchedule)
        ? draft.inclusionSchedule
        : STANDARD_INCLUSION_ENTRIES.map((entry) => entry.spec),
    },
  };
}

// v3 → v4: the two inclusion lists become one. v3 stored inclusionSchedule as
// plain strings alongside a separately-edited inclusionBullets array, and the
// two had already contradicted each other in real offers — page 4 promising
// "60mm stone benchtops" while page 6 promised "40mm engineered stone", in the
// same fixed-price contract.
//
// The SCHEDULE wins: it is the contractual statement. The stale bullets are
// DROPPED rather than migrated onto summaries, because when two claims conflict
// there is no reliable way to tell which the estimator meant, and carrying
// known-contradictory text into a contract is worse than losing it. A v2
// snapshot arrives here with the freshly seeded template, so anything that
// never diverged still gets its 14 summaries back from
// migrateV2ToV3 → STANDARD_INCLUSION_ENTRIES below.
function migrateV3ToV4(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured to DROP it
  const { inclusionBullets: _droppedBullets, ...rest } = draft;
  const schedule = Array.isArray(draft.inclusionSchedule)
    ? draft.inclusionSchedule
    : [];
  const seededSpecs = new Map(
    STANDARD_INCLUSION_ENTRIES.map((entry) => [entry.spec, entry]),
  );
  return {
    ...state,
    schemaVersion: 4,
    draft: {
      ...rest,
      inclusionSchedule: schedule.map((entry) => {
        if (typeof entry !== "string") {
          return entry;
        }
        // An untouched seeded spec regains its summary, so an offer that never
        // diverged keeps a populated page 4. An edited or custom spec becomes a
        // schedule-only entry; the estimator re-adds a label if it earns one.
        return seededSpecs.get(entry) ?? { spec: entry };
      }),
    },
  };
}

// v4 → v5: entries regain `category`, the trade label printed in the schedule's
// Category column. v4 dropped it when the schedule was flattened to plain specs.
//
// Re-attached by matching the spec text against the seeded template, which is
// the only place the mapping exists. An entry whose spec was edited, pulled from
// the cost schedule, or typed from scratch has no template match and stays
// uncategorised — those print UNCATEGORISED_INCLUSION_LABEL rather than an empty
// cell on a contract document.
function migrateV4ToV5(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  const schedule = Array.isArray(draft.inclusionSchedule)
    ? draft.inclusionSchedule
    : [];
  const categoryBySpec = new Map(
    STANDARD_INCLUSION_ENTRIES.filter((entry) => entry.category !== undefined).map(
      (entry) => [entry.spec, entry.category as string],
    ),
  );
  return {
    ...state,
    schemaVersion: 5,
    draft: {
      ...draft,
      inclusionSchedule: schedule.map((entry) => {
        if (typeof entry !== "string") {
          const e = entry as Record<string, unknown>;
          if (typeof e.category === "string") {
            return e;
          }
          const match =
            typeof e.spec === "string" ? categoryBySpec.get(e.spec) : undefined;
          return match === undefined ? e : { ...e, category: match };
        }
        const match = categoryBySpec.get(entry);
        return match === undefined ? { spec: entry } : { spec: entry, category: match };
      }),
    },
  };
}

// v5 → v6: the selling list moves off the schedule rows and becomes its own
// list. v5 stored it as a `summary` on each entry, which asserted one selling
// line per contract row — but on a real offer "All structural works — slab,
// frame, roof" covers six rows (#3 Frame, #4 Roof, #5 Roof Trusses, #56, #59).
// A per-row field could never hold that, which is what made the estimator
// maintain the mapping by hand.
//
// Summaries are lifted out IN SCHEDULE ORDER — the order they already printed
// in — so page 4 is byte-identical after the migration. Nothing is lost: a
// summary was only ever a line of page-4 text.
function migrateV5ToV6(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const draft = (state.draft ?? {}) as Record<string, unknown>;
  const schedule = Array.isArray(draft.inclusionSchedule)
    ? draft.inclusionSchedule
    : [];
  const highlights: string[] = [];
  const stripped = schedule.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      return raw;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured to DROP
    const { summary, summaryFromSpec, ...rest } = raw as Record<string, unknown>;
    if (typeof summary === "string" && summary.trim().length > 0) {
      highlights.push(summary);
    }
    return rest;
  });
  return {
    ...state,
    schemaVersion: 6,
    draft: {
      ...draft,
      inclusionHighlights: Array.isArray(draft.inclusionHighlights)
        ? draft.inclusionHighlights
        : highlights,
      inclusionSchedule: stripped,
    },
  };
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
    job: {
      ...snapshot.job,
      buildScope: [...snapshot.job.buildScope],
      // Clone the readonly owner arrays into mutable copies to match the
      // persisted (zod-inferred) shape.
      owners: snapshot.job.owners.map((owner) => ({
        ...owner,
        signatories: owner.signatories.map((signatory) => ({ ...signatory })),
      })),
    },
    costLines: snapshot.lines.map((line) => ({
      id: line.id,
      stageCode: line.stageCode,
      itemName: line.itemName,
      buildingSequenceTasks: [...line.buildingSequenceTasks],
      offerTenderLineItem: line.offerTenderLineItem,
      tradeOrVendor: line.tradeOrVendor,
      notesOrSpec: line.notesOrSpec,
      formula: line.formula,
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
      exclusionBullets: [...snapshot.draft.exclusionBullets],
      inclusionHighlights: [...snapshot.draft.inclusionHighlights],
      inclusionSchedule: snapshot.draft.inclusionSchedule.map((entry) => ({
        spec: entry.spec,
        ...(entry.category === undefined ? {} : { category: entry.category }),
        ...(entry.draftedByAi === undefined
          ? {}
          : { draftedByAi: entry.draftedByAi }),
      })),
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
    tenderGate: { ...snapshot.tenderGate },
    adminContentVersion: snapshot.adminContentVersion,
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
    // Merge defaults so old offers persisted with retired calculator fields
    // (slabRatePerSqm, dropEdgeLinealMeters, etc.) hydrate with zero defaults
    // for the new field names. Extra old fields are harmless — the calculation
    // functions only read the current fields.
    areaCalculator: {
      ...INITIAL_AREA_CALCULATOR,
      ...(persisted.areaCalculator as Record<string, number>),
    } as unknown as OfferAreaCalculator,
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
    tenderGate: persisted.tenderGate,
    adminContentVersion: persisted.adminContentVersion,
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
