import type { OfferWorkspaceStatus } from "./workspace-model";

// Which Offer-build step a lock decision is about. These are the five steps of
// the Offer phase, in order; the later Tender/Contract/Handoff phases gate on
// status separately (see lib/offer/workflow → isOfferPhaseUnlocked).
export type OfferBuildStep =
  | "job-setup"
  | "cost-schedule"
  | "pricing"
  | "scope"
  | "offer-document";

// Whether an Offer-build step still accepts edits at a given offer status.
//
// The offer does NOT freeze all at once when it is issued (#117). While it is
// still being negotiated — `pending` or `sent` — the estimator keeps refining
// the CUSTOMER-FACING proposal: the Offer document copy and the Scope shown on
// it. Those edits auto-save over the offer (the workspace autosave and the
// server save both already allow `sent`; the price the client sees updates on
// the next send — that is the negotiation loop).
//
// The internal PRICE INPUTS (Job setup areas, Cost schedule, Pricing) freeze the
// moment the offer is issued (`sent` onward) so the quoted price cannot drift in
// place; changing them after send is a New revision. This keeps the pricing
// model intact: every binding document is generated from a snapshot frozen at
// its own gate (the Contract from the agreed snapshot; the acceptance PDF at
// send), and those gates all sit at or after `offer_sent`, which is fully locked.
//
// Everything freezes once the offer is out for a signature (`offer_sent`),
// accepted (`offer_signed`), agreed, or in any terminal/declined state.
//
// See CONTEXT.md "Offer editing persistence" / "Offer workspace entry" and
// docs/adr/0005.
export function isOfferBuildStepEditable(
  step: OfferBuildStep,
  status: OfferWorkspaceStatus,
): boolean {
  switch (step) {
    case "scope":
    case "offer-document":
      // Customer-facing content stays editable through the `sent` negotiation
      // window.
      return status === "pending" || status === "sent";
    case "job-setup":
    case "cost-schedule":
    case "pricing":
      // Price inputs freeze as soon as the offer is issued.
      return status === "pending";
  }
}

// True once ANY Offer-build step has frozen — i.e. the offer has been issued
// (it left `pending`). Drives the lock banner shown above the steps.
export function isOfferIssued(status: OfferWorkspaceStatus): boolean {
  return status !== "pending";
}

// True while the offer is issued but the customer-facing document + scope are
// still editable (the `sent` negotiation window). The lock banner uses this to
// explain the PARTIAL lock — price frozen, document still editable — rather than
// the full lock that applies once the offer is out for signature / agreed /
// terminal. Kept in terms of the step rule so the two can never disagree.
export function offerDocumentStillEditableWhileIssued(
  status: OfferWorkspaceStatus,
): boolean {
  return isOfferIssued(status) && isOfferBuildStepEditable("offer-document", status);
}
