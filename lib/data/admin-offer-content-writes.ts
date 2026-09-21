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

type AdminOfferContentDb = Prisma.TransactionClient | typeof prisma;

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
export async function getAdminOfferContentNonCache(
  db: AdminOfferContentDb = prisma,
): Promise<AdminOfferContent> {
  const row = await db.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!row) {
    const created = await db.adminOfferContent.create({
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
export async function resolveSingletonId(
  db: AdminOfferContentDb = prisma,
): Promise<string> {
  const existing = await db.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await db.adminOfferContent.create({
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

/**
 * Persist one section through the same optimistic-version gate used by the
 * Eve admin operation and the app's Server Actions. This module deliberately
 * contains no Next.js imports: Eve loads it through Node's ESM loader.
 *
 * Omitting expectedVersion preserves the legacy unconditional writers used by
 * the admin editor. Agent writes always provide it, so a retry or two-tab edit
 * cannot overwrite a newer contractual default while reporting success.
 */
export async function updateAdminOfferContentSection(
  input: {
    data: Prisma.AdminOfferContentUpdateManyMutationInput;
    expectedVersion?: number;
  },
  db: AdminOfferContentDb = prisma,
): Promise<number> {
  const id = await resolveSingletonId(db);
  const updated = await db.adminOfferContent.updateMany({
    where:
      input.expectedVersion === undefined
        ? { id }
        : { id, version: input.expectedVersion },
    data: {
      ...input.data,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    if (input.expectedVersion === undefined)
      throw new Error("Admin offer content could not be saved.");
    throw new Error(
      "Admin offer content changed during the update; reload and review again.",
    );
  }
  return (input.expectedVersion ?? 0) + 1;
}

export async function updateBuildScope(
  buildScope: BuildScopeLines,
): Promise<void> {
  await updateAdminOfferContentSection({ data: { buildScope } });
}

export async function updateCostSchedule(
  data: CostScheduleData,
): Promise<void> {
  await updateAdminOfferContentSection({
    data: { costSchedule: data as unknown as Prisma.InputJsonValue },
  });
}

export async function updateOfferScope(data: OfferScopeData): Promise<void> {
  await updateAdminOfferContentSection({
    data: { offerScope: data as unknown as Prisma.InputJsonValue },
  });
}

export async function updateOfferContent(
  data: OfferContentData,
): Promise<void> {
  await updateAdminOfferContentSection({
    data: { offerContent: data as unknown as Prisma.InputJsonValue },
  });
}

export async function updateHBCFClaim(data: HBCFClaimData): Promise<void> {
  await updateAdminOfferContentSection({
    data: { hbcfClaim: data as unknown as Prisma.InputJsonValue },
  });
}
