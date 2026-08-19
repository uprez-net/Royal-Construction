"use server";

import type { LeadStage, OfferStatus, Prisma } from "@prisma/client";

import { leadStagePatchForOfferStatus } from "@/lib/leads/offer-stage-map";

/**
 * Move a lead's stage to match what its offer's status implies.
 *
 * Every offer path that changes a status calls this, because there is no one
 * place a status is written: sends, signature webhooks, the workspace
 * transition and the project handoff each write it themselves. The decision is
 * a pure function (lib/leads/offer-stage-map.ts); this only performs the write.
 *
 * BEST EFFORT, ALWAYS. A failure here must never roll back the offer status or
 * the signature that caused it. The DocuSign webhook in particular answers 500
 * on a throw specifically so DocuSign retries — so an exception escaping this
 * function would turn a recorded signature into an infinite redelivery loop.
 * A lead whose stage lags is a reporting problem; a lost signature is not.
 * Same rationale as the offer-value sync in lib/data/offer-workspace.ts.
 *
 * Pass `tx` when the caller already holds a transaction, so the stage move and
 * the status write commit together.
 */
export async function syncLeadStageForOffer(args: {
  client: Prisma.TransactionClient;
  leadId: number;
  offerStatus: OfferStatus;
  /**
   * The lead's stage as read inside the same transaction. Reading it outside
   * reintroduces the read-then-write race the webhook's compare-and-swap
   * exists to prevent.
   */
  currentStage: LeadStage | null;
  now?: Date;
}): Promise<void> {
  const { client, leadId, offerStatus, currentStage, now = new Date() } = args;
  try {
    const patch = leadStagePatchForOfferStatus(offerStatus, currentStage, now);
    if (!patch) return;
    await client.lead.update({ where: { id: leadId }, data: patch });
  } catch (error) {
    console.error(
      `[Lead ${leadId}] Failed to sync stage for offer status ${offerStatus}`,
      error,
    );
  }
}
