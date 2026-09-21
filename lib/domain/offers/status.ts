import { OfferStatus, Prisma } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { authorizeOffer } from "../access/offers";
import {
  classifyOfferTransition,
  requiresOwnerGate,
} from "@/lib/offer/offer-workflow-transitions";
import { collectOwnerIssues } from "@/lib/offer/workspace-model";
import { parseWorkspaceState } from "@/lib/offer/workspace-persistence";

// The offer lifecycle state machine, and the write that records a move through
// it. One of the most customer-visible things in the application: the status
// is what the client's document says about itself, and what the Offers list
// and the lead's stage are projected from.
//
// It was written twice, and the copies disagreed on three things that matter:
//
//   1. The app refuses a manual jump into OFFER_SIGNED / TENDER_SIGNED /
//      CONTRACT_SIGNED outside local development — those states must be
//      reached through a real DocuSign completion, because the Connect webhook
//      is what archives the executed PDF, and a status flip without one
//      produces an empty project (issue #90). Eve had no such guard: an agent
//      could put an offer into CONTRACT_SIGNED in production.
//   2. The app syncs the lead's stage AFTER the transaction commits. Eve did it
//      INSIDE, which is the exact failure lib/domain/leads/stage-sync.ts
//      documents: a statement that fails inside a Prisma interactive
//      transaction rolls the whole thing back while `$transaction` still
//      resolves, so the status flip and its OfferStatusEvent vanish and the
//      caller is told it succeeded.
//   3. The app bumps no stateVersion here; Eve incremented it. The save
//      predicate already carries `offerStatus`, so a concurrent status change
//      invalidates a pending save either way. The app's behaviour is the one
//      the workspace was built around and is what this keeps.
//
// The guard and the ordering are the app's. What Eve contributed — an optional
// `expectedStateVersion` in the predicate — is kept, because it is strictly an
// extra guard a caller may choose to pass.

export type CommitTransitionInput = {
  readonly offerId: string;
  readonly toStatus: OfferStatus;
  readonly note?: string;
  /** The status a caller already made its decision against. */
  readonly expectedFromStatus?: OfferStatus;
  /**
   * Refuse the write unless the offer is still at this version. Optional: the
   * app's status controls do not carry one, an Eve tool call does.
   */
  readonly expectedStateVersion?: number;
  /**
   * Skip the owner-completeness gate. Only for callers that have already run
   * it — the send actions validate owners themselves before building the
   * document.
   */
  readonly skipOwnerGate?: boolean;
  /**
   * Skip the state-machine check.
   *
   * Exactly one caller may: the recall path, which has just voided the
   * DocuSign envelope. `classifyOfferTransition` refuses a step back from a
   * document out for signature and tells the operator to use Recall — so
   * running it inside the recall itself would refuse the one action that is
   * allowed to make that move.
   */
  readonly skipTransitionCheck?: boolean;
};

export type CommitTransitionResult = {
  readonly from: OfferStatus;
  readonly to: OfferStatus;
};

const RECALL_DOCUMENT_LABEL = {
  contract: "Contract",
  offer: "offer",
  tender: "Tender",
} as const;

const MANUAL_SIGNED_JUMPS: ReadonlySet<OfferStatus> = new Set([
  OfferStatus.CONTRACT_SIGNED,
  OfferStatus.OFFER_SIGNED,
  OfferStatus.TENDER_SIGNED,
]);

/**
 * Whether this move is available at all, with the message the operator sees.
 *
 * Pure apart from the environment check, so the same refusal text reaches a
 * screen, an Eve envelope and a test.
 */
export function assertTransitionAllowed(
  from: OfferStatus,
  to: OfferStatus,
  options: { allowManualSignedJump?: boolean } = {},
): void {
  // A "mark signed" control would flip the status with no executed PDF behind
  // it, and the project created from it is empty (issue #90). It is a
  // local-development aid only.
  if (
    MANUAL_SIGNED_JUMPS.has(to)
    && options.allowManualSignedJump !== true
    && process.env.NODE_ENV !== "development"
  ) {
    throw new DomainTransitionError(
      "Manual 'mark signed' is disabled outside local development — complete signing via DocuSign.",
      from,
      to,
    );
  }

  const kind = classifyOfferTransition(from, to);
  if (typeof kind === "object") {
    // Stepping back from a document out for signature has to void the envelope
    // first, or the customer keeps a signing link for a document we show as a
    // draft.
    throw new DomainTransitionError(
      `Use Recall envelope to take the ${RECALL_DOCUMENT_LABEL[kind.recall]} back from signature. It voids the DocuSign envelope before the status changes.`,
      from,
      to,
    );
  }
  if (kind === "send-only") {
    throw new DomainTransitionError(
      `An offer moves from ${from} to ${to} only through its own action (sending for signature, or creating the project), not a status change.`,
      from,
      to,
    );
  }
  if (kind === "invalid") {
    throw new DomainTransitionError(
      `Invalid offer transition from ${from} to ${to}`,
      from,
      to,
    );
  }
}

/**
 * Write a lifecycle transition and its audit event, inside the caller's
 * transaction.
 *
 * Deliberately does NOT sync the lead's stage: that has to happen after this
 * transaction commits, on a connection of its own. Every caller follows a
 * successful result with `syncLeadStageForOffer`. See the note at the top of
 * this file, and the longer one in lib/domain/leads/stage-sync.ts.
 *
 * Returns `null` when the conditional write matched no row — the offer moved
 * underneath the caller. That is not an exception: the caller reloads and
 * decides, exactly as it does for a stale save.
 */
export async function commitOfferStatusTransition(
  principal: DomainPrincipal,
  input: CommitTransitionInput,
  tx: DomainDb,
): Promise<CommitTransitionResult | null> {
  await authorizeOffer(principal, input.offerId, tx);

  const offer = await tx.offer.findUnique({
    select: { isActive: true, offerStatus: true, workspaceState: true },
    where: { id: input.offerId },
  });
  if (!offer || !offer.isActive) {
    throw new DomainNotFoundError(
      "The requested offer revision is unavailable.",
    );
  }

  if (
    input.expectedFromStatus !== undefined
    && offer.offerStatus !== input.expectedFromStatus
  ) {
    return null;
  }

  if (input.skipTransitionCheck !== true) {
    assertTransitionAllowed(offer.offerStatus, input.toStatus);
  }

  // Owner completeness gate: SENT locks the offer and AGREED freezes it for
  // the Tender, so both require complete owner parties. A missing name,
  // Current Location or signer email — or a shared signer email — must not be
  // lockable and advanced into the legal documents.
  if (
    input.skipOwnerGate !== true
    && requiresOwnerGate(offer.offerStatus, input.toStatus)
  ) {
    const verb =
      input.toStatus === OfferStatus.SENT
        ? "marking the offer sent"
        : "marking the offer agreed";
    // A blank offer has no owners at all — refuse to lock or freeze it, rather
    // than skipping the check.
    if (!offer.workspaceState) {
      throw new DomainValidationError(
        `Add and save offer content before ${verb}.`,
      );
    }
    const ownerIssues = collectOwnerIssues(
      parseWorkspaceState(offer.workspaceState).job.owners,
    );
    if (ownerIssues.length > 0) {
      throw new DomainValidationError(
        `Complete the owner details before ${verb}: ${ownerIssues.join(" ")}`,
      );
    }
  }

  // Freeze only on the FIRST transition into AGREED. An AGREED → AGREED
  // re-transition is permitted, and must not re-snapshot a since-mutated
  // workspace over the one the customer actually agreed to.
  const freezeAgreed =
    input.toStatus === OfferStatus.AGREED
    && offer.offerStatus !== OfferStatus.AGREED
    && offer.workspaceState !== null;

  const written = await tx.offer.updateMany({
    data: {
      offerStatus: input.toStatus,
      ...(input.toStatus === OfferStatus.SENT ? { sentAt: new Date() } : {}),
      ...(freezeAgreed
        ? {
            acceptedAt: new Date(),
            agreedSnapshot: offer.workspaceState as Prisma.InputJsonValue,
          }
        : {}),
    },
    where: {
      id: input.offerId,
      isActive: true,
      offerStatus: input.expectedFromStatus ?? offer.offerStatus,
      ...(input.expectedStateVersion === undefined
        ? {}
        : { stateVersion: input.expectedStateVersion }),
    },
  });
  if (written.count === 0) return null;

  await tx.offerStatusEvent.create({
    data: {
      actorId: attributionUserId(principal),
      fromStatus: offer.offerStatus,
      note: input.note,
      offerId: input.offerId,
      toStatus: input.toStatus,
    },
  });

  return { from: offer.offerStatus, to: input.toStatus };
}
