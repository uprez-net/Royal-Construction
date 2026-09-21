// Compatibility adapter for scripts and existing Server Action callers.
// Persistence, coercion, authorization and optimistic concurrency live in
// lib/domain/admin/offer-content.ts; this file only supplies the ambient App
// database and preserves the old convenience signatures.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  getAdminOfferContent,
  updateAdminOfferContentSection as updateDomainSection,
  updateBuildScope as updateDomainBuildScope,
  updateCostSchedule as updateDomainCostSchedule,
  updateHBCFClaim as updateDomainHBCFClaim,
  updateOfferContent as updateDomainOfferContent,
  updateOfferScope as updateDomainOfferScope,
} from "@/lib/domain/admin/offer-content";
import {
  coerceCostSchedule,
  coerceHBCFClaim,
  coerceOfferContent,
  coerceOfferScope,
} from "@/lib/domain/admin/offer-content-coerce";
import {
  systemPrincipal,
  type DomainPrincipal,
} from "@/lib/domain/principal";
import type {
  BuildScopeLines,
  CostScheduleData,
  HBCFClaimData,
  OfferContentData,
  OfferScopeData,
} from "@/types/admin-offer-content";

export {
  coerceCostSchedule,
  coerceHBCFClaim,
  coerceOfferContent,
  coerceOfferScope,
};

const LEGACY_PRINCIPAL = systemPrincipal("legacy admin offer-content adapter");

export async function getAdminOfferContentNonCache(
  principal: DomainPrincipal = LEGACY_PRINCIPAL,
  db = prisma,
) {
  return getAdminOfferContent(principal, db);
}

export async function updateAdminOfferContentSection(
  input: {
    data: Prisma.AdminOfferContentUpdateManyMutationInput;
    expectedVersion?: number;
  },
  principal: DomainPrincipal = LEGACY_PRINCIPAL,
  db = prisma,
): Promise<number> {
  return updateDomainSection(principal, input, db);
}

export async function updateBuildScope(
  buildScope: BuildScopeLines,
  principal: DomainPrincipal = LEGACY_PRINCIPAL,
  db = prisma,
): Promise<void> {
  await updateDomainBuildScope(principal, buildScope, db);
}

export async function updateCostSchedule(
  data: CostScheduleData,
  principal: DomainPrincipal = LEGACY_PRINCIPAL,
  db = prisma,
): Promise<void> {
  await updateDomainCostSchedule(principal, data, db);
}

export async function updateOfferScope(
  data: OfferScopeData,
  principal: DomainPrincipal = LEGACY_PRINCIPAL,
  db = prisma,
): Promise<void> {
  await updateDomainOfferScope(principal, data, db);
}

export async function updateOfferContent(
  data: OfferContentData,
  principal: DomainPrincipal = LEGACY_PRINCIPAL,
  db = prisma,
): Promise<void> {
  await updateDomainOfferContent(principal, data, db);
}

export async function updateHBCFClaim(
  data: HBCFClaimData,
  principal: DomainPrincipal = LEGACY_PRINCIPAL,
  db = prisma,
): Promise<void> {
  await updateDomainHBCFClaim(principal, data, db);
}
