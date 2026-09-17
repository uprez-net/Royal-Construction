"use server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";
import {
  type AdminOfferContent,
  ADMIN_OFFER_CONTENT_TAG,
  EMPTY_ADMIN_OFFER_CONTENT,
} from "@/types/admin-offer-content";
import { CACHE_PROFILES } from "@/types/cache";
import {
  coerceCostSchedule,
  coerceHBFCClaim,
  coerceOfferContent,
  coerceOfferScope,
} from "./admin-offer-content-writes";

// Only the read lives here. Every exported async function in a "use server"
// module is a callable Server Action, so the writers moved to
// ./admin-offer-content-writes, reachable only through the guarded actions in
// lib/actions/admin-offer-content.ts.

/**
 * Read the application-wide singleton AdminOfferContent row, creating it with
 * defaults on first access if none exists. The only place that casts Prisma's
 * Json fields into the typed shapes — and it validates before trusting.
 */
export async function getAdminOfferContent(): Promise<AdminOfferContent> {
  "use cache";
  cacheTag(ADMIN_OFFER_CONTENT_TAG);
  cacheLife(CACHE_PROFILES.LONG);

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
        hbfcClaim:
          EMPTY_ADMIN_OFFER_CONTENT.hbfcClaim as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      buildScope: created.buildScope,
      costSchedule: coerceCostSchedule(created.costSchedule),
      offerScope: coerceOfferScope(created.offerScope),
      offerContent: coerceOfferContent(created.offerContent),
      hbfcClaim: coerceHBFCClaim(created.hbfcClaim),
      version: created.version,
    };
  }

  return {
    buildScope: row.buildScope,
    costSchedule: coerceCostSchedule(row.costSchedule),
    offerScope: coerceOfferScope(row.offerScope),
    offerContent: coerceOfferContent(row.offerContent),
    hbfcClaim: coerceHBFCClaim(row.hbfcClaim),
    version: row.version,
  };
}
