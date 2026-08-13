"use server";

import { auth } from "@clerk/nextjs/server";
import { assertCanAccessLead } from "@/lib/offer/access";
import { getUserByClerkIdCached } from "@/lib/data/user";
import {
  checkOfferConsistency,
  draftInclusionHighlights,
  type ConsistencyFinding,
} from "@/lib/offer/inclusion-consistency-ai";

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
    await assertCanAccessLead(user, input.leadId);
  } catch {
    return { ok: false, message: "You do not have access to this lead." };
  }

  return checkOfferConsistency({
    estimated: input.estimated,
    scheduled: input.scheduled,
    excluded: input.excluded,
    offered: input.offered,
  });
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
    await assertCanAccessLead(user, input.leadId);
  } catch {
    return { ok: false, message: "You do not have access to this lead." };
  }

  return draftInclusionHighlights(input.scheduled);
}
