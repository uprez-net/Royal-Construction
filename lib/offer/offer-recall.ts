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
