import { OfferStatus } from "@prisma/client";

// The offer workspace's lifecycle rules. They live here, directive-free, because
// lib/data/offer-workspace.ts is "use server" and may only export async
// functions, so nothing there can be unit-tested.

// The three documents that go out for signature, each recalled on its own. A
// tender recall must never void a contract envelope.
export type RecallScope = "offer" | "tender" | "contract";

// Allowed lifecycle transitions for the offer WORKSPACE (the legacy
// OFFER_STATE_MACHINE in offers.ts treats these new states as terminal). The
// early offer phase (pending/sent/agreed/rejected) moves flexibly; the
// tender→contract→project progression must pass each gate in order. A
// self-transition is always allowed so the UI's post-server-action status sync
// (the dedicated send actions already advanced the row) is a harmless no-op.
//
// Two kinds of edge are deliberately missing. Stepping back from a *_SENT status
// is a recall (RECALL_EDGES): the DocuSign envelope has to be voided first, so
// only recallOfferEnvelope may write it. Moving into TENDER_SENT, CONTRACT_SENT
// or PROJECT is written by the send action or the project handoff, which do the
// real work in the same step (SEND_ONLY_EDGES). Either kind done as a bare
// status change moved our status while DocuSign said otherwise.
export const OFFER_WORKFLOW_TRANSITIONS: Readonly<
  Partial<Record<OfferStatus, readonly OfferStatus[]>>
> = {
  PENDING: [OfferStatus.SENT, OfferStatus.AGREED, OfferStatus.REJECTED],
  SENT: [OfferStatus.AGREED, OfferStatus.REJECTED, OfferStatus.PENDING],
  // Offer-acceptance signing (ADR 0004). SENT → OFFER_SENT is performed by the
  // sendOfferForSignature action (atomic claim), not this map, and the step back
  // to SENT is a recall. OFFER_SIGNED → AGREED is the estimator's "Mark agreed";
  // OFFER_SIGNED via transition is a dev-only simulate (guarded in
  // transitionOfferStatus, like the Tender). A declined acceptance re-opens for
  // a new revision.
  OFFER_SENT: [OfferStatus.OFFER_SIGNED],
  OFFER_SIGNED: [OfferStatus.AGREED, OfferStatus.SENT],
  // A declined acceptance only re-opens for renegotiation / a new revision — it
  // must NOT jump straight to AGREED (that would bypass signature into the Tender
  // flow). Reaching AGREED requires going back through SENT first.
  OFFER_DECLINED: [OfferStatus.SENT, OfferStatus.PENDING],
  REJECTED: [OfferStatus.PENDING, OfferStatus.SENT, OfferStatus.AGREED],
  AGREED: [OfferStatus.TENDER_DRAFT, OfferStatus.SENT, OfferStatus.PENDING],
  TENDER_DRAFT: [OfferStatus.AGREED],
  TENDER_SENT: [OfferStatus.TENDER_SIGNED],
  TENDER_SIGNED: [OfferStatus.CONTRACT_DRAFT],
  CONTRACT_DRAFT: [OfferStatus.TENDER_SIGNED],
  CONTRACT_SENT: [OfferStatus.CONTRACT_SIGNED],
  CONTRACT_SIGNED: [],
  PROJECT: [],
};

export type RecallEdge = {
  readonly scope: RecallScope;
  readonly to: OfferStatus;
};

// The only way back from a document that is out for signature, keyed by the
// status it is recalled from. The scope is derived from here, never taken from
// the caller.
export const RECALL_EDGES: Readonly<Partial<Record<OfferStatus, RecallEdge>>> = {
  OFFER_SENT: { scope: "offer", to: OfferStatus.SENT },
  TENDER_SENT: { scope: "tender", to: OfferStatus.TENDER_DRAFT },
  CONTRACT_SENT: { scope: "contract", to: OfferStatus.CONTRACT_DRAFT },
};

// Written only by sendTenderForSignature, sendContractForSignature and
// createProjectFromOffer, each of which does the real work in the same step.
const SEND_ONLY_EDGES: Readonly<Partial<Record<OfferStatus, OfferStatus>>> = {
  TENDER_DRAFT: OfferStatus.TENDER_SENT,
  CONTRACT_DRAFT: OfferStatus.CONTRACT_SENT,
  CONTRACT_SIGNED: OfferStatus.PROJECT,
};

// Own keys only: a status that happens to name an Object.prototype member
// ("constructor", "toString") must not find an inherited value.
function ownEntry<V>(
  table: Readonly<Partial<Record<OfferStatus, V>>>,
  status: OfferStatus,
): V | undefined {
  return Object.hasOwn(table, status) ? table[status] : undefined;
}

export type OfferTransitionKind =
  | "self"
  | "allowed"
  | { readonly recall: RecallScope }
  | "send-only"
  | "invalid";

export function classifyOfferTransition(
  from: OfferStatus,
  to: OfferStatus,
): OfferTransitionKind {
  if (from === to) {
    return "self";
  }
  const recall = ownEntry(RECALL_EDGES, from);
  if (recall !== undefined && recall.to === to) {
    return { recall: recall.scope };
  }
  if (ownEntry(SEND_ONLY_EDGES, from) === to) {
    return "send-only";
  }
  if ((ownEntry(OFFER_WORKFLOW_TRANSITIONS, from) ?? []).includes(to)) {
    return "allowed";
  }
  return "invalid";
}

// SENT locks the offer and AGREED freezes it for the Tender, so moving into
// either needs complete owner parties (PR #124). A recall back to SENT is not a
// new commitment: the offer passed this gate when it was first sent, and it is
// fully locked while out for signature, so the owners cannot be fixed there.
// Gating the recall would leave a voided envelope behind a status that can
// never step back.
export function requiresOwnerGate(from: OfferStatus, to: OfferStatus): boolean {
  if (from === to) {
    return false;
  }
  if (to !== OfferStatus.SENT && to !== OfferStatus.AGREED) {
    return false;
  }
  return ownEntry(RECALL_EDGES, from)?.to !== to;
}
