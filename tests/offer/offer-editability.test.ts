import assert from "node:assert/strict";
import {
  isOfferBuildStepEditable,
  isOfferIssued,
  offerDocumentStillEditableWhileIssued,
  type OfferBuildStep,
} from "../../lib/offer/offer-editability";
import type { OfferWorkspaceStatus } from "../../lib/offer/workspace-model";

// Every offer status the lifecycle can be in. Keyed as a Record over
// OfferWorkspaceStatus so a new status added to the union without a decision
// here fails to COMPILE (missing key) rather than silently escaping the
// exhaustiveness checks below.
const STATUS_PRESENCE: Record<OfferWorkspaceStatus, true> = {
  pending: true,
  sent: true,
  offer_sent: true,
  offer_signed: true,
  offer_declined: true,
  agreed: true,
  tender_draft: true,
  tender_sent: true,
  tender_signed: true,
  tender_declined: true,
  contract_draft: true,
  contract_sent: true,
  contract_signed: true,
  contract_declined: true,
  project: true,
  rejected: true,
  superseded: true,
};
const ALL_STATUSES = Object.keys(STATUS_PRESENCE) as OfferWorkspaceStatus[];

const PRICE_INPUT_STEPS: readonly OfferBuildStep[] = [
  "job-setup",
  "cost-schedule",
  "pricing",
];
const CUSTOMER_FACING_STEPS: readonly OfferBuildStep[] = [
  "scope",
  "offer-document",
];

// ── Price inputs (Job setup / Cost schedule / Pricing) are editable ONLY while
//    pending, so the quoted price can't drift in place once the offer is issued. ──
for (const step of PRICE_INPUT_STEPS) {
  for (const status of ALL_STATUSES) {
    assert.equal(
      isOfferBuildStepEditable(step, status),
      status === "pending",
      `${step} editable should be pending-only, failed at ${status}`,
    );
  }
}

// ── Customer-facing content (Scope + Offer document) stays editable through the
//    `sent` negotiation window, then freezes. ──
for (const step of CUSTOMER_FACING_STEPS) {
  for (const status of ALL_STATUSES) {
    assert.equal(
      isOfferBuildStepEditable(step, status),
      status === "pending" || status === "sent",
      `${step} editable should be pending|sent, failed at ${status}`,
    );
  }
}

// ── Issued = anything past pending. ──
for (const status of ALL_STATUSES) {
  assert.equal(
    isOfferIssued(status),
    status !== "pending",
    `isOfferIssued failed at ${status}`,
  );
}

// ── The partial-lock signal for the banner: true ONLY in `sent` (issued, but the
//    document is still editable). Never in pending (not issued) or once out for
//    signature / agreed / terminal (document frozen). ──
for (const status of ALL_STATUSES) {
  assert.equal(
    offerDocumentStillEditableWhileIssued(status),
    status === "sent",
    `offerDocumentStillEditableWhileIssued should be sent-only, failed at ${status}`,
  );
}

// ── Spot-checks that read as the intended behaviour (regression guard for #117):
//    after generation/send, the customer-facing document is editable but the
//    price is not; once out for signature everything freezes. ──
assert.equal(isOfferBuildStepEditable("offer-document", "sent"), true);
assert.equal(isOfferBuildStepEditable("scope", "sent"), true);
assert.equal(isOfferBuildStepEditable("pricing", "sent"), false);
assert.equal(isOfferBuildStepEditable("cost-schedule", "sent"), false);
assert.equal(isOfferBuildStepEditable("job-setup", "sent"), false);
assert.equal(isOfferBuildStepEditable("offer-document", "offer_sent"), false);
assert.equal(isOfferBuildStepEditable("offer-document", "agreed"), false);

console.log("offer-editability: all assertions passed");
