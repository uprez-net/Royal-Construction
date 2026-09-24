"use server";

import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import {
  checkOfferConsistency,
  draftInclusionHighlights,
  type ConsistencyFinding,
} from "@/lib/offer/inclusion-consistency-ai";
import {
  checkOfferLists as checkOfferListsDomain,
  draftOfferHighlights,
} from "@/lib/domain/offers/inclusions";
import { userPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";
import { isDomainError } from "@/lib/domain/errors";

const inclusionAi = {
  checkConsistency: checkOfferConsistency,
  draftHighlights: draftInclusionHighlights,
};

// Audit the offer's lists: estimated -> schedule -> offer, including what the
// document explicitly excludes.
// Returns findings only. Nothing is written, and the model authors no text.

export type OfferConsistencyResult =
  | { ok: true; findings: readonly ConsistencyFinding[] }
  | { ok: false; message: string };

export async function checkOfferLists(input: {
  readonly leadId: number;
  readonly estimated: readonly string[];
  readonly scheduled: readonly string[];
  readonly excluded: readonly string[];
  readonly offered: readonly string[];
}): Promise<OfferConsistencyResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, message: "Not signed in." };
  }
  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    return { ok: false, message: "No matching user." };
  }
  try {
    return await checkOfferListsDomain(
      userPrincipal(user),
      input,
      prisma,
      inclusionAi,
    );
  } catch (error) {
    if (isDomainError(error)) return { ok: false, message: error.message };
    throw error;
  }
}

export type DraftHighlightsResult =
  | { ok: true; highlights: readonly string[] }
  | { ok: false; message: string };

// Draft the offer's selling list from the contractual schedule. Returns the
// lines for the estimator to accept or edit; writes nothing.
export async function draftHighlightsForOffer(input: {
  readonly leadId: number;
  readonly scheduled: readonly string[];
}): Promise<DraftHighlightsResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, message: "Not signed in." };
  }
  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    return { ok: false, message: "No matching user." };
  }
  try {
    return await draftOfferHighlights(
      userPrincipal(user),
      input,
      prisma,
      inclusionAi,
    );
  } catch (error) {
    if (isDomainError(error)) return { ok: false, message: error.message };
    throw error;
  }
}
