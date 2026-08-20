'use server';
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
import {
  type AdminOfferContent,
  type BuildScopeLines,
  type CostScheduleData,
  type OfferContentData,
  type OfferScopeData,
  ADMIN_OFFER_CONTENT_TAG,
  EMPTY_ADMIN_OFFER_CONTENT,
  HBFCClaimData,
} from "@/types/admin-offer-content";
import { CACHE_PROFILES } from "@/types/cache";
import {
  costScheduleDataSchema,
  offerScopeDataSchema,
  offerContentDataSchema,
  hbfcClaimDataSchema,
} from "@/lib/validations/admin-offer-content";

/**
 * Read the application-wide singleton AdminOfferContent row, creating it with
 * defaults on first access if none exists. The only place that casts Prisma's
 * Json fields into the typed shapes — and it validates before trusting.
 */
export async function getAdminOfferContent(): Promise<AdminOfferContent> {
  'use cache';
  cacheTag(ADMIN_OFFER_CONTENT_TAG);
  cacheLife(CACHE_PROFILES.LONG);

  const row = await prisma.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!row) {
    const created = await prisma.adminOfferContent.create({
      data: {
        buildScope: EMPTY_ADMIN_OFFER_CONTENT.buildScope,
        costSchedule: EMPTY_ADMIN_OFFER_CONTENT.costSchedule as unknown as Prisma.InputJsonValue,
        offerScope: EMPTY_ADMIN_OFFER_CONTENT.offerScope as unknown as Prisma.InputJsonValue,
        offerContent: EMPTY_ADMIN_OFFER_CONTENT.offerContent as unknown as Prisma.InputJsonValue,
        hbfcClaim: EMPTY_ADMIN_OFFER_CONTENT.hbfcClaim as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      buildScope: created.buildScope,
      costSchedule: coerceCostSchedule(created.costSchedule),
      offerScope: coerceOfferScope(created.offerScope),
      offerContent: coerceOfferContent(created.offerContent),
      hbfcClaim: coerceHBFCClaim(created.hbfcClaim),
    };
  }

  return {
    buildScope: row.buildScope,
    costSchedule: coerceCostSchedule(row.costSchedule),
    offerScope: coerceOfferScope(row.offerScope),
    offerContent: coerceOfferContent(row.offerContent),
    hbfcClaim: coerceHBFCClaim(row.hbfcClaim),
  };
}
/**
 * Read the application-wide singleton AdminOfferContent row, creating it with
 * defaults on first access if none exists. The only place that casts Prisma's
 * Json fields into the typed shapes — and it validates before trusting.
 *
 * This version does not use caching, so it can be used in scripts that seed or
 * update the row without risk of reading stale data from a cache.
 *
 * @returns The singleton AdminOfferContent row, with Json fields coerced to
 * their typed shapes.
 */
export async function getAdminOfferContentNonCache(): Promise<AdminOfferContent> {
  const row = await prisma.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!row) {
    const created = await prisma.adminOfferContent.create({
      data: {
        buildScope: EMPTY_ADMIN_OFFER_CONTENT.buildScope,
        costSchedule: EMPTY_ADMIN_OFFER_CONTENT.costSchedule as unknown as Prisma.InputJsonValue,
        offerScope: EMPTY_ADMIN_OFFER_CONTENT.offerScope as unknown as Prisma.InputJsonValue,
        offerContent: EMPTY_ADMIN_OFFER_CONTENT.offerContent as unknown as Prisma.InputJsonValue,
        hbfcClaim: EMPTY_ADMIN_OFFER_CONTENT.hbfcClaim as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      buildScope: created.buildScope,
      costSchedule: coerceCostSchedule(created.costSchedule),
      offerScope: coerceOfferScope(created.offerScope),
      offerContent: coerceOfferContent(created.offerContent),
      hbfcClaim: coerceHBFCClaim(created.hbfcClaim),
    };
  }

  return {
    buildScope: row.buildScope,
    costSchedule: coerceCostSchedule(row.costSchedule),
    offerScope: coerceOfferScope(row.offerScope),
    offerContent: coerceOfferContent(row.offerContent),
    hbfcClaim: coerceHBFCClaim(row.hbfcClaim),
  };
}

function coerceCostSchedule(value: unknown): CostScheduleData {
  const parsed = costScheduleDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { rows: [], rateConstants: {} };
}

function coerceOfferScope(value: unknown): OfferScopeData {
  const parsed = offerScopeDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { allowances: [], exclusions: [] };
}

function coerceOfferContent(value: unknown): OfferContentData {
  const parsed = offerContentDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { headline: "", introText: "", inclusions: [], termsAndConditions: "" };
}

function coerceHBFCClaim(value: unknown): HBFCClaimData {
  const parsed = hbfcClaimDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { claimAmount: 0, loadingChargePercent: 0, totalPremiumToBePaid: 0 };
}

/**
 * Resolve the singleton row id, creating the row on first use. Each `update*`
 * helper below calls this then upserts only its own column, so a save on one
 * tab never clobbers another tab's stored data.
 */
async function resolveSingletonId(): Promise<string> {
  const existing = await prisma.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.adminOfferContent.create({
    data: {
      buildScope: EMPTY_ADMIN_OFFER_CONTENT.buildScope,
      costSchedule: EMPTY_ADMIN_OFFER_CONTENT.costSchedule as unknown as Prisma.InputJsonValue,
      offerScope: EMPTY_ADMIN_OFFER_CONTENT.offerScope as unknown as Prisma.InputJsonValue,
      offerContent: EMPTY_ADMIN_OFFER_CONTENT.offerContent as unknown as Prisma.InputJsonValue,
      hbfcClaim: EMPTY_ADMIN_OFFER_CONTENT.hbfcClaim as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return created.id;
}

export async function updateBuildScope(
  buildScope: BuildScopeLines,
): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: { buildScope },
  });
}

export async function updateCostSchedule(
  data: CostScheduleData,
): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: { costSchedule: data as unknown as Prisma.InputJsonValue },
  });
}

export async function updateOfferScope(
  data: OfferScopeData,
): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: { offerScope: data as unknown as Prisma.InputJsonValue },
  });
}

export async function updateOfferContent(
  data: OfferContentData,
): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: { offerContent: data as unknown as Prisma.InputJsonValue },
  });
}

export async function updateHBFCClaim(
  data: HBFCClaimData,
): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: { hbfcClaim: data as unknown as Prisma.InputJsonValue },
  });
}