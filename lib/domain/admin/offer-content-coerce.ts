import type {
  CostScheduleData,
  HBCFClaimData,
  OfferContentData,
  OfferScopeData,
} from "@/types/admin-offer-content";
import {
  costScheduleDataSchema,
  costScheduleRowSchema,
  hbcfClaimDataSchema,
  inclusionScheduleRowSchema,
  offerAllowanceSchema,
  offerContentDataSchema,
  offerExclusionSchema,
  offerScopeDataSchema,
} from "@/lib/validations/admin-offer-content";
import { INITIAL_OFFER_DRAFT } from "@/lib/offer/workspace-model";
import type { ZodType } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coerceFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coerceNonnegNumber(value: unknown, fallback: number): number {
  const amount = coerceFiniteNumber(value, fallback);
  return amount >= 0 ? amount : fallback;
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function keepParsed<T>(value: unknown, schema: ZodType<T>): T[] {
  if (!Array.isArray(value)) return [];
  const kept: T[] = [];
  for (const item of value) {
    const parsed = schema.safeParse(item);
    if (parsed.success) kept.push(parsed.data);
  }
  return kept;
}

function derivedHbcfPremium(
  claimAmount: number,
  loadingChargePercent: number,
): number {
  return (
    Math.round(
      (claimAmount + (claimAmount * loadingChargePercent) / 100) * 100,
    ) / 100
  );
}

export function coerceCostSchedule(value: unknown): CostScheduleData {
  const parsed = costScheduleDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!isRecord(value)) return { rows: [], rateConstants: {} };

  const rateConstants: CostScheduleData["rateConstants"] = {};
  if (isRecord(value.rateConstants)) {
    for (const [key, amount] of Object.entries(value.rateConstants)) {
      if (typeof amount === "number" && Number.isFinite(amount)) {
        rateConstants[key as keyof typeof rateConstants] = amount;
      }
    }
  }

  return {
    rows: keepParsed(value.rows, costScheduleRowSchema),
    rateConstants,
  };
}

export function coerceOfferScope(value: unknown): OfferScopeData {
  const parsed = offerScopeDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!isRecord(value)) return { allowances: [], exclusions: [] };
  return {
    allowances: keepParsed(value.allowances, offerAllowanceSchema),
    exclusions: keepParsed(value.exclusions, offerExclusionSchema),
  };
}

export function coerceOfferContent(value: unknown): OfferContentData {
  const parsed = offerContentDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fallback: OfferContentData = {
    headline: INITIAL_OFFER_DRAFT.headline,
    introText: INITIAL_OFFER_DRAFT.introText,
    inclusions: [...INITIAL_OFFER_DRAFT.inclusionHighlights],
    exclusions: [...INITIAL_OFFER_DRAFT.exclusionBullets],
    inclusionSchedule: [...INITIAL_OFFER_DRAFT.inclusionSchedule],
    termsAndConditions: INITIAL_OFFER_DRAFT.termsSummary,
  };
  if (!isRecord(value)) return fallback;
  return {
    headline: coerceString(value.headline, fallback.headline),
    introText: coerceString(value.introText, fallback.introText),
    inclusions: Array.isArray(value.inclusions)
      ? value.inclusions.filter(
          (item): item is string => typeof item === "string",
        )
      : fallback.inclusions,
    exclusions: Array.isArray(value.exclusions)
      ? value.exclusions.filter(
          (item): item is string => typeof item === "string",
        )
      : fallback.exclusions,
    inclusionSchedule: Array.isArray(value.inclusionSchedule)
      ? keepParsed(value.inclusionSchedule, inclusionScheduleRowSchema)
      : fallback.inclusionSchedule,
    termsAndConditions: coerceString(
      value.termsAndConditions,
      fallback.termsAndConditions,
    ),
  };
}

export function coerceHBCFClaim(value: unknown): HBCFClaimData {
  const parsed = hbcfClaimDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const record = isRecord(value) ? value : {};
  const claimAmount = coerceNonnegNumber(record.claimAmount, 0);
  const loadingChargePercent = coerceNonnegNumber(
    record.loadingChargePercent,
    0,
  );
  const storedPremium = record.totalPremiumToBePaid;
  return {
    claimAmount,
    loadingChargePercent,
    totalPremiumToBePaid:
      typeof storedPremium === "number" && Number.isFinite(storedPremium)
        ? storedPremium
        : derivedHbcfPremium(claimAmount, loadingChargePercent),
  };
}
