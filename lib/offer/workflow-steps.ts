import type { OfferStepId } from "@/lib/offer/step-digests";
import type { TenderGateStatus } from "@/lib/offer/workspace-persistence";
import type { OfferWorkflowPhase } from "@/lib/offer/workflow";
import type { OfferWorkspaceStatus } from "@/lib/offer/workspace-model";

// The ten workflow steps, in order. One definition, consumed by the step rail
// and by anything that needs to name a step.
//
// `sectionId` is the legacy DOM id ("offer-step-pricing"). Send blockers carry
// it so the readiness strip can jump to the offending step — the best
// interaction on the old page, and worth keeping. In the new shell that jump
// selects the step rather than scrolling to it.

export type OfferWorkflowStep = {
  readonly id: OfferStepId;
  readonly label: string;
  readonly phase: OfferWorkflowPhase;
  readonly sectionId: string;
};

export const OFFER_WORKFLOW_STEPS: readonly OfferWorkflowStep[] = [
  {
    id: "job-setup",
    label: "Job setup",
    phase: "offer",
    sectionId: "offer-step-job-setup",
  },
  {
    id: "cost-schedule",
    label: "Cost schedule",
    phase: "offer",
    sectionId: "offer-step-cost-schedule",
  },
  {
    id: "pricing",
    label: "Pricing",
    phase: "offer",
    sectionId: "offer-step-pricing",
  },
  { id: "scope", label: "Scope", phase: "offer", sectionId: "offer-step-scope" },
  {
    id: "offer-document",
    label: "Offer document",
    phase: "offer",
    sectionId: "offer-step-offer-document",
  },
  {
    id: "send",
    label: "Send & negotiate",
    phase: "offer",
    sectionId: "offer-step-send",
  },
  {
    id: "tender-gate",
    label: "Tender access",
    phase: "tender",
    sectionId: "offer-step-tender-gate",
  },
  {
    id: "tender",
    label: "Tender",
    phase: "tender",
    sectionId: "offer-step-tender",
  },
  {
    id: "contract",
    label: "Contract",
    phase: "contract",
    sectionId: "offer-step-contract",
  },
  {
    id: "project",
    label: "Project",
    phase: "handoff",
    sectionId: "offer-step-project",
  },
];

export const OFFER_WORKFLOW_PHASES: readonly {
  readonly id: OfferWorkflowPhase;
  readonly label: string;
}[] = [
  { id: "offer", label: "Offer" },
  { id: "tender", label: "Tender" },
  { id: "contract", label: "Contract" },
  { id: "handoff", label: "Handoff" },
];

// Which step the offer is actually at. The Tender access gate sits between Send
// & negotiate and Tender: while the offer is AGREED but the gate is unresolved
// the current step is "Tender access"; once the gate unlocks (or the offer
// reaches tender_draft) it becomes "Tender".
export function currentOfferStepId(
  status: OfferWorkspaceStatus,
  tenderGateStatus: TenderGateStatus,
): OfferStepId {
  switch (status) {
    case "sent":
    // Offer-acceptance signing (ADR 0004) is still the Send & negotiate step.
    case "offer_sent":
    case "offer_signed":
    case "offer_declined":
      return "send";
    case "agreed":
      return tenderGateStatus === "unlocked" ? "tender" : "tender-gate";
    case "tender_draft":
    case "tender_sent":
    case "tender_declined":
      return "tender";
    case "tender_signed":
    case "contract_draft":
    case "contract_sent":
    case "contract_declined":
      return "contract";
    case "contract_signed":
    case "project":
      return "project";
    case "pending":
    default:
      return "job-setup";
  }
}

// The step a send blocker points at, so the readiness strip can select it.
export function stepIdForSectionId(sectionId: string): OfferStepId | null {
  return (
    OFFER_WORKFLOW_STEPS.find((step) => step.sectionId === sectionId)?.id ?? null
  );
}
