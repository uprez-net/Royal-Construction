"use server";

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import {
  type ContractParticularKey,
  type ContractParticulars,
} from "@/lib/offer/contract-particulars";
import { saveContractParticulars as saveContractParticularsDomain } from "@/lib/domain/offers/contract-particulars";
import { userPrincipal } from "@/lib/domain/principal";
import { appOfferSendEffects } from "@/lib/data/offer-send-effects";
import {
  sendContractEnvelope,
  type ContractSendResult,
} from "@/lib/offer/sends/contract-envelope";

// Send the BC4 Contract for signature. The work is
// lib/offer/sends/contract-envelope.ts, which Eve calls too; this is the
// Clerk check and the cache expiry.
export async function sendContractForSignature(input: {
  offerId: string;
  customerEmail?: string;
}): Promise<ContractSendResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  return sendContractEnvelope(access.user, input, prisma, appOfferSendEffects);
}

type SaveParticularsResult = { ok: true } | { ok: false; error: string };

// Persist the estimator's BC4 particulars while the contract is a draft (issue
// #98). Upserts the Contract row so the values survive to send time, where they
// go out as locked tabs. Only editable in CONTRACT_DRAFT — once the envelope is
// sent the particulars are frozen into it and can't be changed without a recall.
export async function saveContractParticulars(input: {
  offerId: string;
  particulars: ContractParticulars;
  manualOverrides: readonly ContractParticularKey[];
}): Promise<SaveParticularsResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }

  // The length limits and the lock-and-conditional-write are
  // lib/domain/offers/contract-particulars.ts, shared with Eve's tool — which
  // previously read "is it a draft?" and then upserted, so a concurrent send
  // could land the write after the envelope had gone out.
  const result = await saveContractParticularsDomain(
    userPrincipal(access.user),
    input,
    prisma,
  );
  if (!result.ok) {
    return result;
  }
  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  return { ok: true };
}
