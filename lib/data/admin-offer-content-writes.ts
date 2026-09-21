// The admin offer-content writers. Deliberately NOT "use server": in a
// "use server" module every exported async function is its own Server Action,
// callable by POST from any page. These rewrite the boilerplate pre-filled onto
// every offer created afterwards and authorize nothing themselves, so while they
// lived in lib/data/admin-offer-content.ts the admin guard on the actions could
// simply be walked around. The guarded actions in
// lib/actions/admin-offer-content.ts are the only client-reachable way in.
//
// No `import "server-only"` either: scripts/seed-admin-offer-content.ts runs
// these under tsx, outside the react-server condition, where that import throws.
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  type AdminOfferContent,
  type BuildScopeLines,
  type CostScheduleData,
  type HBCFClaimData,
  type OfferContentData,
  type OfferScopeData,
  EMPTY_ADMIN_OFFER_CONTENT,
} from "@/types/admin-offer-content";
import {
  coerceCostSchedule,
  coerceHBCFClaim,
  coerceOfferContent,
  coerceOfferScope,
} from "./admin-offer-content-coerce";

export {
  coerceCostSchedule,
  coerceHBCFClaim,
  coerceOfferContent,
  coerceOfferScope,
};

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
        costSchedule:
          EMPTY_ADMIN_OFFER_CONTENT.costSchedule as unknown as Prisma.InputJsonValue,
        offerScope:
          EMPTY_ADMIN_OFFER_CONTENT.offerScope as unknown as Prisma.InputJsonValue,
        offerContent:
          EMPTY_ADMIN_OFFER_CONTENT.offerContent as unknown as Prisma.InputJsonValue,
        hbcfClaim:
          EMPTY_ADMIN_OFFER_CONTENT.hbcfClaim as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      buildScope: created.buildScope,
      costSchedule: coerceCostSchedule(created.costSchedule),
      offerScope: coerceOfferScope(created.offerScope),
      offerContent: coerceOfferContent(created.offerContent),
      hbcfClaim: coerceHBCFClaim(created.hbcfClaim),
      version: created.version,
    };
  }

  return {
    buildScope: row.buildScope,
    costSchedule: coerceCostSchedule(row.costSchedule),
    offerScope: coerceOfferScope(row.offerScope),
    offerContent: coerceOfferContent(row.offerContent),
    hbcfClaim: coerceHBCFClaim(row.hbcfClaim),
    version: row.version,
  };
}

/**
 * Resolve the singleton row id, creating the row on first use. Each `update*`
 * helper below calls this then upserts only its own column, so a save on one
 * tab never clobbers another tab's stored data.
 *
 * Every `update*` also increments `version`. That single counter is what lets an
 * OPEN, still-editable offer notice that admin content changed under it and
 * re-apply the current defaults (see reapplyAdminContentIfStale in
 * lib/data/offer-workspace.ts); agreed/sent offers keep their frozen snapshot.
 * The callers in lib/actions/admin-offer-content.ts still revalidate
 * ADMIN_OFFER_CONTENT_TAG so the cached read picks the new version up.
 */
export async function resolveSingletonId(): Promise<string> {
  const existing = await prisma.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.adminOfferContent.create({
    data: {
      buildScope: EMPTY_ADMIN_OFFER_CONTENT.buildScope,
      costSchedule:
        EMPTY_ADMIN_OFFER_CONTENT.costSchedule as unknown as Prisma.InputJsonValue,
      offerScope:
        EMPTY_ADMIN_OFFER_CONTENT.offerScope as unknown as Prisma.InputJsonValue,
      offerContent:
        EMPTY_ADMIN_OFFER_CONTENT.offerContent as unknown as Prisma.InputJsonValue,
      hbcfClaim:
        EMPTY_ADMIN_OFFER_CONTENT.hbcfClaim as unknown as Prisma.InputJsonValue,
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
    data: { buildScope, version: { increment: 1 } },
  });
}

export async function updateCostSchedule(
  data: CostScheduleData,
): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: {
      costSchedule: data as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
}

export async function updateOfferScope(data: OfferScopeData): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: {
      offerScope: data as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
}

export async function updateOfferContent(
  data: OfferContentData,
): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: {
      offerContent: data as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
}

export async function updateHBCFClaim(data: HBCFClaimData): Promise<void> {
  const id = await resolveSingletonId();
  await prisma.adminOfferContent.update({
    where: { id },
    data: {
      hbcfClaim: data as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
}
