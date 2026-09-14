import type { OfferStatus, Prisma } from "@prisma/client";
import {
  RECALL_EDGES,
  type RecallScope,
} from "./offer-workflow-transitions";

// Recall decisions, kept out of the "use server" module so they can be tested.
// recallOfferEnvelope is a Server Action: every argument it receives comes from
// the client and is checked here before anything is voided.

// Which of an offer's live envelopes to pull back. "all" is for Create revision
// only; a recall always names one document.
export type OfferEnvelopeScope = RecallScope | "all";

export function envelopeScopeFilter(
  offerId: string,
  scope: OfferEnvelopeScope,
): Prisma.EnvelopeWhereInput[] {
  switch (scope) {
    // A live OFFER-acceptance envelope (ADR 0004) hangs off the offer directly.
    case "offer":
      return [{ offerId }];
    case "tender":
      return [{ tender: { offerId } }];
    case "contract":
      return [{ contract: { offerId } }];
    case "all":
      return [{ tender: { offerId } }, { contract: { offerId } }, { offerId }];
    default: {
      // Without this, an unknown scope fell out of the switch as undefined.
      // Prisma drops `OR: undefined`, so the void query matched every live
      // envelope in the database, for every customer.
      const unknownScope: never = scope;
      throw new Error(`Unknown envelope scope: ${String(unknownScope)}`);
    }
  }
}

export type RecallResolution =
  | {
      readonly ok: true;
      readonly scope: RecallScope;
      readonly from: OfferStatus;
      readonly to: OfferStatus;
    }
  | { readonly ok: false; readonly error: string };

// The scope and the target status come from the offer's own status. The
// client's `scope` and `toStatus` are only accepted when they say the same
// thing, so a stale tab or a hand-built request cannot recall a different
// document or land the offer somewhere else.
export function resolveRecall(
  scope: unknown,
  toStatus: unknown,
  currentStatus: OfferStatus,
  isActive: boolean,
): RecallResolution {
  if (!isActive) {
    return {
      ok: false,
      error:
        "This revision has been replaced by a newer one, so there is nothing to recall on it. Open the current revision.",
    };
  }
  const edge = Object.hasOwn(RECALL_EDGES, currentStatus)
    ? RECALL_EDGES[currentStatus]
    : undefined;
  if (edge === undefined) {
    return {
      ok: false,
      error:
        "Nothing on this offer is out for signature, so there is nothing to recall. Refresh to see its current status.",
    };
  }
  if (typeof scope !== "string" || scope !== edge.scope || toStatus !== edge.to) {
    return {
      ok: false,
      error:
        "This recall does not match the document that is out for signature. Refresh and try again.",
    };
  }
  return { ok: true, scope: edge.scope, from: currentStatus, to: edge.to };
}

export type EnvelopeVoidOutcome = {
  // Every envelope in scope that was still live when the recall started.
  readonly liveIds: readonly string[];
  // Envelopes DocuSign confirmed voided (or that never reached DocuSign).
  readonly voidedIds: readonly string[];
  // Envelopes DocuSign did not confirm: they may still be signable.
  readonly failedIds: readonly string[];
};

// A recall or a revision moves on only when every live envelope in scope is
// confirmed dead. The alternative, which this replaced, moved the offer to a
// draft while DocuSign had not voided the envelope, so an estimator edited a
// document the customer could still sign. No live envelopes at all is a clean
// pull-back: there is nothing a customer can sign.
export function decideRecallPullBack(outcome: EnvelopeVoidOutcome): {
  readonly proceed: boolean;
} {
  const voided = new Set(outcome.voidedIds);
  return {
    proceed:
      outcome.failedIds.length === 0 &&
      outcome.liveIds.every((id) => voided.has(id)),
  };
}

// What the estimator is told when a void was not confirmed. It has to say the
// document is still signable, and must not claim nothing changed: an envelope
// voided before a later one failed stays voided, because voiding is final.
export function describeUnconfirmedVoid(input: {
  // DocuSign's envelope ids, which is what the estimator can find in DocuSign.
  readonly failedEnvelopeIds: readonly string[];
  readonly voidedCount: number;
  readonly action: "recall" | "revision";
}): string {
  const failed = input.failedEnvelopeIds;
  const which =
    failed.length === 0
      ? "an envelope"
      : failed.length === 1
        ? `envelope ${failed[0]}`
        : `envelopes ${failed.join(", ")}`;
  const unchanged =
    input.action === "recall"
      ? "The offer's status was not changed."
      : "No revision was created.";
  const alreadyVoided =
    input.voidedCount === 0
      ? ""
      : input.voidedCount === 1
        ? " One other envelope was voided and stays voided."
        : ` ${input.voidedCount} other envelopes were voided and stay voided.`;
  const voidThere = failed.length > 1 ? "void them" : "void it";
  const retry =
    input.action === "recall" ? "recall again" : "create the revision again";
  return `The document is still out for signature: DocuSign did not confirm the void of ${which} (it may already be signed or declined, or DocuSign could not be reached). ${unchanged}${alreadyVoided} Try again, or ${voidThere} in DocuSign, refresh, and ${retry}.`;
}
