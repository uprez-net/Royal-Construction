"use server";

import { auth } from "@clerk/nextjs/server";
import { assertCanAccessLead } from "@/lib/offer/access";
import { getUserByClerkIdCached } from "@/lib/data/user";
import {
  checkOfferConsistency,
  type ConsistencyFinding,
} from "@/lib/offer/inclusion-consistency-ai";

// Audit the offer's three lists: priced -> promised -> sold.
// Returns findings only. Nothing is written, and the model authors no text.

export type OfferConsistencyResult =
  | { ok: true; findings: readonly ConsistencyFinding[] }
  | { ok: false; message: string };

export async function checkOfferLists(input: {
  readonly leadId: number;
  readonly pricedItems: readonly string[];
  readonly promised: readonly string[];
  readonly sold: readonly string[];
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
    pricedItems: input.pricedItems,
    promised: input.promised,
    sold: input.sold,
  });
}
