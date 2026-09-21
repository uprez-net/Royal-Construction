"use server";

import { auth } from "@clerk/nextjs/server";

import { getUserByClerkIdCached } from "@/lib/data/user";
import {
  generateOfferPrefill,
  type OfferPrefillResult,
} from "@/lib/domain/offers/prefill";
import { userPrincipal } from "@/lib/domain/principal";
import { isDomainError } from "@/lib/domain/errors";
import prisma from "@/lib/prisma";
import { generateOfferPrefillDraft } from "@/lib/offer/offer-prefill-ai";

export type { OfferPrefillResult };

export async function generateOfferPrefillFromLead(input: {
  leadId: number;
}): Promise<OfferPrefillResult> {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) {
    return { error: "Unauthorized", ok: false };
  }
  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    return {
      error: "No internal user for the signed-in account.",
      ok: false,
    };
  }
  try {
    return await generateOfferPrefill(
      userPrincipal(user),
      input.leadId,
      prisma,
      generateOfferPrefillDraft,
    );
  } catch (error) {
    if (isDomainError(error)) return { error: error.message, ok: false };
    throw error;
  }
}
