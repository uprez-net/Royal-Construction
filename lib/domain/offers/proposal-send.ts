import { OfferStatus, OutboxEventKind } from "@prisma/client";

import { authorizeOffer } from "../access/offers";
import type { TransactionalDomainDb } from "../db";
import { DomainTransitionError } from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import type { OfferEmailMessage, OfferEmailPort } from "../ports/offer-email";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { syncLeadStageForOffer } from "../leads/stage-sync";
import {
  canEmailOfferProposal,
  PROPOSAL_STAGE_PASSED_ERROR,
} from "@/lib/offer/offer-send-guards";

export type ProposalRecipient = {
  readonly email: string;
  readonly token: string;
  readonly message: OfferEmailMessage;
};

export type SendOfferProposalResult = {
  readonly deliveredEmails: readonly string[];
  readonly replayedEmails: readonly string[];
  readonly statusChanged: boolean;
};

export class OfferProposalSendError extends Error {
  readonly deliveredEmails: readonly string[];

  constructor(message: string, deliveredEmails: readonly string[]) {
    super(message);
    this.name = "OfferProposalSendError";
    this.deliveredEmails = deliveredEmails;
  }
}

/**
 * Send and record one deliberate proposal attempt.
 *
 * `attemptId` is minted by the click handler and reused by transport retries.
 * Each recipient gets a separate durable key, so a partial send records exactly
 * who received the proposal and never re-emails a successful recipient when the
 * same request is replayed.
 */
export async function sendOfferProposal(
  principal: DomainPrincipal,
  input: {
    readonly attemptId: string;
    readonly offerId: string;
    readonly offerFileVersion: number;
    readonly recipients: readonly ProposalRecipient[];
  },
  db: TransactionalDomainDb,
  port: OfferEmailPort,
): Promise<SendOfferProposalResult> {
  if (!input.attemptId.trim()) {
    throw new DomainTransitionError("A proposal send attempt id is required.");
  }
  const access = await authorizeOffer(principal, input.offerId, db);
  const offer = await db.offer.findUnique({
    select: { offerStatus: true },
    where: { id: access.offerId },
  });
  if (!offer) throw new DomainTransitionError("Offer not found.");
  if (!canEmailOfferProposal(offer.offerStatus)) {
    throw new DomainTransitionError(PROPOSAL_STAGE_PASSED_ERROR);
  }

  const deliveredEmails: string[] = [];
  const replayedEmails: string[] = [];
  let statusChanged = false;
  for (const recipient of input.recipients) {
    const emailKey = recipient.email.trim().toLowerCase();
    try {
      const outcome = await runOutboxEffectWithOutcome(
        db,
        {
          key: `offer-proposal:${input.offerId}:${input.attemptId}:${emailKey}`,
          kind: OutboxEventKind.OFFER_DOCUMENT_SEND,
          payload: {
            offerFileVersion: input.offerFileVersion,
            offerId: input.offerId,
            recipientEmail: recipient.email,
            trackedLinkToken: recipient.token,
          },
        },
        async () => {
          await port.send(recipient.message);
          await db.offerDocumentSend.create({
            data: {
              offerFileVersion: input.offerFileVersion,
              offerId: input.offerId,
              recipientEmail: recipient.email,
              trackedLinkToken: recipient.token,
            },
          });
          return { accepted: true, recipientEmail: recipient.email };
        },
      );
      deliveredEmails.push(recipient.email);
      if (outcome.replayed) replayedEmails.push(recipient.email);

      // Commit SENT after the first accepted recipient, not after the whole
      // fan-out. If recipient two fails, recipient one still received Royal's
      // quote and the workspace must not remain editable as PENDING.
      if (offer.offerStatus === OfferStatus.PENDING && !statusChanged) {
        const flip = await db.offer.updateMany({
          data: { offerStatus: OfferStatus.SENT, sentAt: new Date() },
          where: { id: input.offerId, offerStatus: OfferStatus.PENDING },
        });
        statusChanged = flip.count === 1;
        if (statusChanged) {
          try {
            await db.offerStatusEvent.create({
              data: {
                actorId: attributionUserId(principal),
                fromStatus: OfferStatus.PENDING,
                note: `Emailed to ${recipient.email}`,
                offerId: input.offerId,
                toStatus: OfferStatus.SENT,
              },
            });
          } catch (error) {
            console.error("[offer] status event after send failed:", error);
          }
          await syncLeadStageForOffer(input.offerId, db);
        }
      }
    } catch (error) {
      throw new OfferProposalSendError(
        (error as Error).message,
        deliveredEmails,
      );
    }
  }

  return { deliveredEmails, replayedEmails, statusChanged };
}
