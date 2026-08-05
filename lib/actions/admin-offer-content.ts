"use server";

import { revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";
import {
  type BuildScopeLines,
  type CostScheduleData,
  type OfferScopeData,
  type OfferContentData,
  ADMIN_OFFER_CONTENT_TAG,
} from "@/types/admin-offer-content";
import {
  buildScopeSchema,
  costScheduleDataSchema,
  offerScopeDataSchema,
  offerContentDataSchema,
} from "@/lib/validations/admin-offer-content";
import {
  updateBuildScope,
  updateCostSchedule,
  updateOfferScope,
  updateOfferContent,
} from "@/lib/data/admin-offer-content";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

function invalid(error: string): ActionResult {
  return { success: false, error };
}

export async function saveBuildScopeAction(
  buildScope: BuildScopeLines,
): Promise<ActionResult> {
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
