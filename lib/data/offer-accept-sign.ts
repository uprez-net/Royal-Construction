"use server";

import prisma from "@/lib/prisma";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import { appOfferSendEffects } from "@/lib/data/offer-send-effects";
import {
  sendOfferAcceptanceEnvelope,
  type OfferAcceptanceSendResult,
} from "@/lib/offer/sends/acceptance-envelope";

// Send the Offer document for acceptance signing (ADR 0004). The work is
// lib/offer/sends/acceptance-envelope.ts, which Eve calls too; this is the
// Clerk check and the cache expiry.
export async function sendOfferForSignature(input: {
  offerId: string;
}): Promise<OfferAcceptanceSendResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  return sendOfferAcceptanceEnvelope(
    access.user,
    input,
    prisma,
    appOfferSendEffects,
  );
}
