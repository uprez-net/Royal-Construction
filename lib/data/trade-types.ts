import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  listTradeTypes,
  listTradeTypesForAdmin,
} from "@/lib/domain/tradies/trade-types";
import type { DomainPrincipal } from "@/lib/domain/principal";
import { CACHE_PROFILES } from "@/types/cache";
import {
  TRADE_TYPES_TAG,
  type TradeTypeAdminRow,
  type TradeTypeOption,
} from "@/types/trade-type";

// The Next adapter over lib/domain/tradies/trade-types.ts: the cache and the
// Clerk principal. The rules are the domain's.
//
// Neither read swallows a failure. A picker that silently lists no trades
// looks like a directory with nothing in it; useTradeTypes() shows the error
// and a retry instead.

async function cachedTradeTypes(
  principal: DomainPrincipal,
): Promise<TradeTypeOption[]> {
  "use cache";

  cacheTag(TRADE_TYPES_TAG);
  cacheLife(CACHE_PROFILES.LONG);

  return listTradeTypes(principal, prisma);
}

/** The trades a tradie can be given, for the pickers. */
export async function getTradeTypes(): Promise<TradeTypeOption[]> {
  return cachedTradeTypes(await currentPrincipal());
}

/** Every trade with its tradie count, for Admin → Trade types. Uncached. */
export async function getTradeTypesForAdmin(): Promise<TradeTypeAdminRow[]> {
  return listTradeTypesForAdmin(await currentPrincipal(), prisma);
}
