import { cacheLife, cacheTag } from "next/cache";

import type { LeadListScope } from "@/lib/domain/access/leads";
import {
  emptyOfferGroupResult,
  emptyOfferKPIs,
  queryOfferGroups as queryOfferGroupsDomain,
  queryOfferKPIs as queryOfferKPIsDomain,
} from "@/lib/domain/offers/listing";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import type { OfferStatusBucket } from "@/types/offer";

export { emptyOfferGroupResult, emptyOfferKPIs };

export async function queryOfferGroups(
  page: number | undefined,
  limit: number | undefined,
  q: string | undefined,
  status: OfferStatusBucket | undefined,
  scope: LeadListScope,
) {
  return queryOfferGroupsDomain(prisma, page, limit, q, status, scope);
}

export async function queryOfferKPIs(scope: LeadListScope) {
  return queryOfferKPIsDomain(prisma, scope);
}

export const getOfferGroupsCached = async (
  page: number | undefined,
  limit: number | undefined,
  q: string | undefined,
  status: OfferStatusBucket | undefined,
  scope: LeadListScope,
) => {
  "use cache";
  cacheTag("offers");
  cacheLife(CACHE_PROFILES.MEDIUM);
  return queryOfferGroups(page, limit, q, status, scope);
};

export const getOfferKPIsCached = async (scope: LeadListScope) => {
  "use cache";
  cacheTag("offers");
  cacheLife(CACHE_PROFILES.MEDIUM);
  return queryOfferKPIs(scope);
};
