"use server";

import prisma from "@/lib/prisma";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import { appOfferSendEffects } from "@/lib/data/offer-send-effects";
import {
  emailOfferProposal,
  type OfferProposalEmailResult,
} from "@/lib/offer/sends/proposal-email";

// Email the offer PDF to every customer signatory. The work is
// lib/offer/sends/proposal-email.ts, which Eve calls too; this is the Clerk
// check and the cache expiry.
export async function sendOfferDocument(input: {
  offerId: string;
  recipientEmail: string;
  secondaryRecipientEmail?: string | null;
  sendAttemptId: string;
}): Promise<OfferProposalEmailResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  return emailOfferProposal(access.user, input, prisma, appOfferSendEffects);
}
