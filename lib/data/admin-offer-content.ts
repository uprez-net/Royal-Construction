import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
import {
  type AdminOfferContent,
  type BuildScopeLines,
  type CostScheduleData,
  type OfferContentData,
  type OfferScopeData,
  EMPTY_ADMIN_OFFER_CONTENT,
} from "@/types/admin-offer-content";
import { CACHE_PROFILES } from "@/types/cache";
import {
  costScheduleDataSchema,
  offerScopeDataSchema,
  offerContentDataSchema,
} from "@/lib/validations/admin-offer-content";

// Singleton cache tag shared by every read/write of this row, so any save
// invalidates the cached read used by the server page.
export const ADMIN_OFFER_CONTENT_TAG = "admin-offer-content";

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
      },
    });
    return {
      buildScope: created.buildScope,
      costSchedule: coerceCostSchedule(created.costSchedule),
      offerScope: coerceOfferScope(created.offerScope),
      offerContent: coerceOfferContent(created.offerContent),
    };
  }

  return {
    buildScope: row.buildScope,
    costSchedule: coerceCostSchedule(row.costSchedule),
    offerScope: coerceOfferScope(row.offerScope),
    offerContent: coerceOfferContent(row.offerContent),
  };
}

function coerceCostSchedule(value: unknown): CostScheduleData {
  const parsed = costScheduleDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { rows: [], formulaVariables: {} };
}

function coerceOfferScope(value: unknown): OfferScopeData {
  const parsed = offerScopeDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { allowances: [], exclusions: [] };
}

function coerceOfferContent(value: unknown): OfferContentData {
  const parsed = offerContentDataSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { inclusions: [], termsAndConditions: "" };
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

