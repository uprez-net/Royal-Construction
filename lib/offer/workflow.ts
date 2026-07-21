import type { OfferWorkspaceStatus } from "./workspace-model";

// The offer lifecycle runs across three phases — Offer, Tender, Contract —
// then the signed Contract is handed off to Project. See CONTEXT.md and
// docs/adr/0001. This module is the single source of truth for mapping an
// Offer status to its phase, shared by the stepper and the phase gates.
export type OfferWorkflowPhase = "offer" | "tender" | "contract" | "handoff";

export const OFFER_WORKFLOW_PHASES: readonly OfferWorkflowPhase[] = [
  "offer",
  "tender",
  "contract",
  "handoff",
];

export function offerPhaseIndex(phase: OfferWorkflowPhase): number {
  return OFFER_WORKFLOW_PHASES.indexOf(phase);
}

// The phase the Offer is currently working in, derived from its status. A
// completed (*_signed) state belongs to the NEXT phase, since finishing one
// phase opens the work of the next (e.g. tender_signed → Contract begins).
export function activeOfferPhase(
  status: OfferWorkspaceStatus,
): OfferWorkflowPhase {
  switch (status) {
    case "agreed":
    case "tender_draft":
    case "tender_sent":
    // A declined tender stays in the Tender phase so the operator can revise
    // and re-issue it.
    case "tender_declined":
      return "tender";
    case "tender_signed":
    case "contract_draft":
    case "contract_sent":
    case "contract_declined":
      return "contract";
    case "contract_signed":
    case "project":
      return "handoff";
    case "pending":
    case "sent":
    case "rejected":
    case "superseded":
    default:
      return "offer";
  }
}

// A phase is unlocked once the Offer status has reached (or passed) it.
export function isOfferPhaseUnlocked(
  status: OfferWorkspaceStatus,
  phase: OfferWorkflowPhase,
): boolean {
  return offerPhaseIndex(activeOfferPhase(status)) >= offerPhaseIndex(phase);
}
