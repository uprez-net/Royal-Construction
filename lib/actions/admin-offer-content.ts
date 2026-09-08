"use server";

import { revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";
import {
  type BuildScopeLines,
  type CostScheduleData,
  type OfferScopeData,
  type OfferContentData,
  ADMIN_OFFER_CONTENT_TAG,
  HBFCClaimData,
} from "@/types/admin-offer-content";
import {
  buildScopeSchema,
  costScheduleDataSchema,
  offerScopeDataSchema,
  offerContentDataSchema,
  hbfcClaimDataSchema,
} from "@/lib/validations/admin-offer-content";
import { requireAdminUser } from "@/lib/auth/require-admin";
import {
  updateBuildScope,
  updateCostSchedule,
  updateOfferScope,
  updateOfferContent,
  updateHBFCClaim,
} from "@/lib/data/admin-offer-content";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

function invalid(error: string): ActionResult {
  return { success: false, error };
}

/**
 * Every action in this file rewrites the boilerplate that is pre-filled onto
 * EVERY offer created afterwards, each of which becomes a fixed-price
 * contractual document. The middleware's `/admin(.*)` matcher does not cover
 * these: a Server Action POSTs to the caller's current URL, so invoked from any
 * non-admin route the pathname check never fires. Each one authorizes itself.
 */
async function guard(): Promise<ActionResult | null> {
  const access = await requireAdminUser();
  return access.ok ? null : invalid(access.error);
}

export async function saveBuildScopeAction(
  buildScope: BuildScopeLines,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) {
    return denied;
  }

  const parsed = buildScopeSchema.safeParse(buildScope);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => i.message).join("; "));
  }
  try {
    await updateBuildScope(parsed.data);
    revalidateTag(ADMIN_OFFER_CONTENT_TAG, CACHE_PROFILES.SHORT);
    return { success: true };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Failed to save build scope.");
  }
}

export async function saveCostScheduleAction(
  data: CostScheduleData,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) {
    return denied;
  }

  const parsed = costScheduleDataSchema.safeParse(data);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => i.message).join("; "));
  }
  try {
    await updateCostSchedule(parsed.data);
    revalidateTag(ADMIN_OFFER_CONTENT_TAG, CACHE_PROFILES.SHORT);
    return { success: true };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Failed to save cost schedule.");
  }
}

export async function saveOfferScopeAction(
  data: OfferScopeData,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) {
    return denied;
  }

  const parsed = offerScopeDataSchema.safeParse(data);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => i.message).join("; "));
  }
  try {
    await updateOfferScope(parsed.data);
    revalidateTag(ADMIN_OFFER_CONTENT_TAG, CACHE_PROFILES.SHORT);
    return { success: true };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Failed to save offer scope.");
  }
}

export async function saveOfferContentAction(
  data: OfferContentData,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) {
    return denied;
  }

  const parsed = offerContentDataSchema.safeParse(data);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => i.message).join("; "));
  }
  try {
    await updateOfferContent(parsed.data);
    revalidateTag(ADMIN_OFFER_CONTENT_TAG, CACHE_PROFILES.SHORT);
    return { success: true };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Failed to save offer content.");
  }
}

export async function saveHBFCClaimAction(
  data: HBFCClaimData,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) {
    return denied;
  }

  // This was the only save of the five with no schema check. `claimAmount` is
  // read as the whole-book HBCF sum assured (lib/data/insurance.ts), so an
  // emptied field committing NaN wrote a value that reads back as zero and
  // reported success. z.number() rejects NaN and Infinity.
  const parsed = hbfcClaimDataSchema.safeParse(data);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => i.message).join("; "));
  }
  try {
    await updateHBFCClaim(parsed.data);
    revalidateTag(ADMIN_OFFER_CONTENT_TAG, CACHE_PROFILES.SHORT);
    return { success: true };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Failed to save HBCF claim.");
  }
}
