// Call-time gating for the WebMCP offers tools.
//
// The agent cannot see a disabled fieldset. Where a person is stopped by
// `OfferStepSection`'s `locked` prop rendering `<fieldset disabled>`, a tool
// call has to be stopped by an explicit check — and the refusal has to say
// enough that the agent self-corrects instead of retrying the same write.
//
// Nothing here is a new rule. Every decision defers to the predicates the UI
// already locks on (./offer-editability, ./workflow), so a tool and a form can
// never disagree about whether a section is writable. This module only turns
// those booleans into sentences an agent can act on.
import {
  isOfferBuildStepEditable,
  offerDocumentStillEditableWhileIssued,
  type OfferBuildStep,
} from "./offer-editability";
import {
  OFFER_STATUS_LABEL,
  type OfferWorkspaceStatus,
} from "./workspace-model";
import type { OfferWorkflowPhase } from "./workflow";

// Mirrors the tagged union `resolveTransition` uses in the milestones tab: the
// tool flattens the failure to `webMcpError(message)`, so the message IS the
// whole refusal. Never throws — a thrown error reaches the agent as an opaque
// "UnknownError" from the user agent (see components/webmcp/tool-runtime.ts).
export type SectionGate = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Human names for the five Offer-build steps, as the UI titles them. */
export const OFFER_BUILD_STEP_LABEL: Record<OfferBuildStep, string> = {
  "job-setup": "Job setup",
  "cost-schedule": "Cost schedule",
  pricing: "Pricing",
  scope: "Scope",
  "offer-document": "Offer document",
};

/** The step section anchor ids, for scroll-to-edit and for open_offer_section. */
export const OFFER_BUILD_STEP_ANCHOR: Record<OfferBuildStep, string> = {
  "job-setup": "offer-step-job-setup",
  "cost-schedule": "offer-step-cost-schedule",
  pricing: "offer-step-pricing",
  scope: "offer-step-scope",
  "offer-document": "offer-step-offer-document",
};

export const OFFER_BUILD_STEPS: readonly OfferBuildStep[] = [
  "job-setup",
  "cost-schedule",
  "pricing",
  "scope",
  "offer-document",
];

/**
 * Why `step` cannot be written at `status`, or null when it can be.
 *
 * Split out from the gate so the orientation tool can report the same reason as
 * an `unlockCondition` on a section it is only reading. One wording, both uses.
 */
export function sectionLockReason(
  step: OfferBuildStep,
  status: OfferWorkspaceStatus,
): string | null {
  if (isOfferBuildStepEditable(step, status)) {
    return null;
  }

  const label = OFFER_BUILD_STEP_LABEL[step];
  const statusLabel = OFFER_STATUS_LABEL[status];

  // A superseded revision is not locked so much as no longer the one that
  // matters. Telling the agent to create a revision here would be wrong — the
  // newer revision already exists.
  if (status === "superseded") {
    return `${label} cannot be edited: this offer revision has been superseded by a newer one (status: ${statusLabel}). Open the lead's active revision and work there.`;
  }

  if (status === "rejected") {
    return `${label} cannot be edited while the offer is ${statusLabel}. A person has to move it back to Pending in the Send & negotiate step before it accepts edits again.`;
  }

  // The partial lock (#117): issued but still being negotiated, so the price
  // inputs are frozen while the customer-facing content is not. Worth spelling
  // out, because the agent CAN still do useful work on this offer.
  if (offerDocumentStillEditableWhileIssued(status)) {
    return `${label} is frozen because the offer has been issued (status: ${statusLabel}), so the quoted price cannot drift in place. The Scope and Offer document are still editable during the negotiation window; changing a priced input needs a new revision, which only a person can start.`;
  }

  return `${label} cannot be edited at status ${statusLabel} — the offer is past the point where its contents can change. Changing it needs a new revision, which only a person can start from the Send & negotiate step.`;
}

/** The gate every offers write tool calls before touching state. */
export function assertSectionWritable(
  step: OfferBuildStep,
  status: OfferWorkspaceStatus,
): SectionGate {
  const message = sectionLockReason(step, status);
  return message === null ? { ok: true } : { ok: false, message };
}

/**
 * The refusal for a write aimed at a formula-resolved value.
 *
 * Naming the upstream input is the whole point: a bare "not editable" leaves the
 * agent guessing, and guessing here means it edits the wrong field or reports
 * the capability as missing.
 */
export function refuseDerivedField(field: string, upstream: string): string {
  return `${field} is calculated, not stored — writing to it would be discarded on the next recompute. It is resolved from ${upstream}.`;
}

/**
 * What unlocks each later phase, in the words the locked panel shows the user.
 *
 * Shared with offer-workspace-screen.tsx so the agent is told exactly what the
 * person looking at the screen is told. Two copies of this would drift the first
 * time one was reworded, and the agent's copy is the one nobody would notice.
 */
export const OFFER_PHASE_UNLOCK_HINT: Record<
  Exclude<OfferWorkflowPhase, "offer">,
  string
> = {
  tender:
    "Unlocks once the Offer is agreed. Decide whether tender access unlocks immediately or is held pending an architectural-plan fee and upload.",
  contract:
    "Unlocks once the Tender is signed. Generate the Contract from the Tender data and send it via DocuSign for both parties to sign.",
  handoff:
    "Unlocks once the Contract is signed. Create the Project and seed the costing report from the internal cost lines.",
};
