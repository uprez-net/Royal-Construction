import type { Prisma } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainTransitionError } from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
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
} from "./offer-content-coerce";

export {
  coerceCostSchedule,
  coerceHBCFClaim,
  coerceOfferContent,
  coerceOfferScope,
};

/**
 * Read the singleton admin defaults row without framework caching.
 *
 * The App cached read and the Eve/script callers all use this command, so a
 * newly-created or repaired JSON row has one coercion implementation.
 */
export async function getAdminOfferContent(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<AdminOfferContent> {
  // Reading defaults is also needed while creating a customer offer. Only
  // section writes are administrator-only; the caller still supplies an
  // explicit principal so this read cannot silently grow request auth later.
  void principal;
  const row = await db.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!row) {
    const created = await db.adminOfferContent.create({
      data: defaultCreateData(),
    });
    return shape(created);
  }

  return shape(row);
}

/**
 * Update exactly one defaults section behind the optimistic version gate.
 * The version check is part of the domain mutation, not an Eve-only guard.
 */
export async function updateAdminOfferContentSection(
  principal: DomainPrincipal,
  input: {
    data: Prisma.AdminOfferContentUpdateManyMutationInput;
    expectedVersion?: number;
  },
  db: DomainDb,
): Promise<number> {
  requireAdminPrincipal(principal);
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
    if (input.expectedVersion === undefined) {
      throw new DomainTransitionError(
        "Admin offer content could not be saved.",
      );
    }
    throw new DomainTransitionError(
      "Admin offer content changed during the update; reload and review again.",
    );
  }
  return (input.expectedVersion ?? 0) + 1;
}

export async function updateBuildScope(
  principal: DomainPrincipal,
  buildScope: BuildScopeLines,
  db: DomainDb,
): Promise<number> {
  return updateAdminOfferContentSection(
    principal,
    { data: { buildScope } },
    db,
  );
}

export async function updateCostSchedule(
  principal: DomainPrincipal,
  data: CostScheduleData,
  db: DomainDb,
): Promise<number> {
  return updateAdminOfferContentSection(
    principal,
    { data: { costSchedule: data as unknown as Prisma.InputJsonValue } },
    db,
  );
}

export async function updateOfferScope(
  principal: DomainPrincipal,
  data: OfferScopeData,
  db: DomainDb,
): Promise<number> {
  return updateAdminOfferContentSection(
    principal,
    { data: { offerScope: data as unknown as Prisma.InputJsonValue } },
    db,
  );
}

export async function updateOfferContent(
  principal: DomainPrincipal,
  data: OfferContentData,
  db: DomainDb,
): Promise<number> {
  return updateAdminOfferContentSection(
    principal,
    { data: { offerContent: data as unknown as Prisma.InputJsonValue } },
    db,
  );
}

export async function updateHBCFClaim(
  principal: DomainPrincipal,
  data: HBCFClaimData,
  db: DomainDb,
): Promise<number> {
  return updateAdminOfferContentSection(
    principal,
    { data: { hbcfClaim: data as unknown as Prisma.InputJsonValue } },
    db,
  );
}

async function resolveSingletonId(db: DomainDb): Promise<string> {
  const existing = await db.adminOfferContent.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await db.adminOfferContent.create({
    data: defaultCreateData(),
    select: { id: true },
  });
  return created.id;
}

function defaultCreateData(): Prisma.AdminOfferContentCreateInput {
  return {
    buildScope: EMPTY_ADMIN_OFFER_CONTENT.buildScope,
    costSchedule:
      EMPTY_ADMIN_OFFER_CONTENT.costSchedule as unknown as Prisma.InputJsonValue,
    offerScope:
      EMPTY_ADMIN_OFFER_CONTENT.offerScope as unknown as Prisma.InputJsonValue,
    offerContent:
      EMPTY_ADMIN_OFFER_CONTENT.offerContent as unknown as Prisma.InputJsonValue,
    hbcfClaim:
      EMPTY_ADMIN_OFFER_CONTENT.hbcfClaim as unknown as Prisma.InputJsonValue,
  };
}

function shape(row: {
  buildScope: string[];
  costSchedule: Prisma.JsonValue;
  offerScope: Prisma.JsonValue;
  offerContent: Prisma.JsonValue;
  hbcfClaim: Prisma.JsonValue;
  version: number;
}): AdminOfferContent {
  return {
    buildScope: row.buildScope,
    costSchedule: coerceCostSchedule(row.costSchedule),
    offerScope: coerceOfferScope(row.offerScope),
    offerContent: coerceOfferContent(row.offerContent),
    hbcfClaim: coerceHBCFClaim(row.hbcfClaim),
    version: row.version,
  };
}
