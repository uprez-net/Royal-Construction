import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isOfferBuildStepEditable,
  type OfferBuildStep,
} from "../../lib/offer/offer-editability";
import {
  assertSectionWritable,
  OFFER_BUILD_STEPS,
  OFFER_BUILD_STEP_ANCHOR,
  OFFER_BUILD_STEP_LABEL,
  refuseDerivedField,
  sectionLockReason,
} from "../../lib/offer/webmcp-gating";
import {
  OFFER_STATUS_LABEL,
  type OfferWorkspaceStatus,
} from "../../lib/offer/workspace-model";

/**
 * The gate is what stands between an agent and a write on a frozen offer. It is
 * a pure function over a small matrix, so the matrix is the test.
 *
 * Keyed as a Record over OfferWorkspaceStatus, following
 * tests/offer/offer-editability.test.ts: a status added to the union without a
 * decision here fails to COMPILE rather than quietly skipping the sweep.
 */
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

test("the gate invents no rule of its own", () => {
  // The whole point of the module: it defers to the predicate the UI locks on.
  // If these ever disagree, a tool and a form disagree about the same offer.
  for (const step of OFFER_BUILD_STEPS) {
    for (const status of ALL_STATUSES) {
      assert.equal(
        assertSectionWritable(step, status).ok,
        isOfferBuildStepEditable(step, status),
        `gate disagrees with isOfferBuildStepEditable at ${step}/${status}`,
      );
    }
  }
});

test("a writable section carries no reason, a locked one always does", () => {
  for (const step of OFFER_BUILD_STEPS) {
    for (const status of ALL_STATUSES) {
      const reason = sectionLockReason(step, status);
      if (isOfferBuildStepEditable(step, status)) {
        assert.equal(reason, null, `${step}/${status} should be writable`);
      } else {
        assert.ok(reason && reason.length > 0, `${step}/${status} refused with no reason`);
      }
    }
  }
});

test("every refusal names the section and the status it is refusing at", () => {
  // An agent that is told only "locked" retries. One told which section, at
  // which status, can decide whether to work elsewhere or hand back.
  for (const step of OFFER_BUILD_STEPS) {
    for (const status of ALL_STATUSES) {
      const reason = sectionLockReason(step, status);
      if (reason === null) continue;
      assert.ok(
        reason.includes(OFFER_BUILD_STEP_LABEL[step]),
        `refusal at ${step}/${status} never names the section`,
      );
      assert.ok(
        reason.includes(OFFER_STATUS_LABEL[status]),
        `refusal at ${step}/${status} never names the status`,
      );
    }
  }
});

test("the four refusal kinds give four different instructions", () => {
  // Superseded, rejected, the partial lock and the full lock each need a
  // different next move. Collapsing any two would send the agent the wrong way.
  const superseded = sectionLockReason("pricing", "superseded");
  const rejected = sectionLockReason("pricing", "rejected");
  const partial = sectionLockReason("pricing", "sent");
  const full = sectionLockReason("pricing", "agreed");

  assert.match(superseded ?? "", /active revision/i);
  assert.match(rejected ?? "", /back to Pending/i);
  assert.match(partial ?? "", /Scope and Offer document are still editable/i);
  assert.match(full ?? "", /new revision/i);

  const distinct = new Set([superseded, rejected, partial, full]);
  assert.equal(distinct.size, 4, "two refusal kinds share the same wording");
});

test("the partial lock is offered only where the document really is editable", () => {
  // `sent` is the one status where a priced input is frozen but the
  // customer-facing content is not. Saying so anywhere else would be a lie the
  // agent then acts on.
  for (const status of ALL_STATUSES) {
    const reason = sectionLockReason("pricing", status);
    if (reason === null) continue;
    const claimsPartial = /still editable/i.test(reason);
    assert.equal(
      claimsPartial,
      status === "sent",
      `pricing refusal at ${status} ${claimsPartial ? "claims" : "denies"} the partial lock wrongly`,
    );
  }
});

test("customer-facing steps stay open through the negotiation window", () => {
  // The behaviour an agent is most likely to need: an issued offer can still
  // have its Scope and Offer document worked on.
  for (const step of ["scope", "offer-document"] as OfferBuildStep[]) {
    assert.ok(assertSectionWritable(step, "sent").ok, `${step} should be writable at sent`);
  }
  for (const step of ["job-setup", "cost-schedule", "pricing"] as OfferBuildStep[]) {
    assert.ok(!assertSectionWritable(step, "sent").ok, `${step} should be frozen at sent`);
  }
});

test("every step has an anchor, and the anchors are the section ids", () => {
  // open_offer_section scrolls to these, and buildOfferReview reports the same
  // strings as its stepIds. A typo here is a scroll that silently does nothing.
  for (const step of OFFER_BUILD_STEPS) {
    assert.equal(OFFER_BUILD_STEP_ANCHOR[step], `offer-step-${step}`);
  }
  assert.equal(new Set(Object.values(OFFER_BUILD_STEP_ANCHOR)).size, OFFER_BUILD_STEPS.length);
});

test("a derived-field refusal names the field and where to write instead", () => {
  const message = refuseDerivedField("slabCost", "the floor areas and the slab rate");
  assert.match(message, /slabCost/);
  assert.match(message, /floor areas and the slab rate/);
  // Without this the agent reads "not editable" as "capability missing".
  assert.match(message, /calculated/i);
});
