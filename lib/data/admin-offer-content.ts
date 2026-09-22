"use server";
import prisma from "@/lib/prisma";
import { cacheTag, cacheLife } from "next/cache";
import {
  type AdminOfferContent,
  ADMIN_OFFER_CONTENT_TAG,
} from "@/types/admin-offer-content";
import { CACHE_PROFILES } from "@/types/cache";
import { getAdminOfferContent as getAdminOfferContentDomain } from "@/lib/domain/admin/offer-content";
import { systemPrincipal } from "@/lib/domain/principal";

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

  return getAdminOfferContentDomain(
    systemPrincipal("cached offer workspace default read"),
    prisma,
  );
}
