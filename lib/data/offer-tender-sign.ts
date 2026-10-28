"use server";

import prisma from "@/lib/prisma";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import { appOfferSendEffects } from "@/lib/data/offer-send-effects";
import {
  sendTenderEnvelope,
  type TenderSendResult,
} from "@/lib/offer/sends/tender-envelope";

// Send the Tender for signature. The work is
// lib/offer/sends/tender-envelope.ts, which Eve calls too; this is the Clerk
// check and the cache expiry.
export async function sendTenderForSignature(input: {
  offerId: string;
}): Promise<TenderSendResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  return sendTenderEnvelope(access.user, input, prisma, appOfferSendEffects);
}
