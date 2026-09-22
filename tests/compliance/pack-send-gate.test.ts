import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";

import {
  clientHasApprovedPlans,
  packSendBlockedReason,
} from "../../lib/domain/compliance/prerequisites";
import type { CertifierEngagementDetail } from "../../types/compliance";

/**
 * What stops the required pack going to the certifier.
 *
 * Three conditions, and none of them is about a missing document — the rows
 * already say what is missing. These are the cases where every row is full and
 * the pack still must not go, which makes them the ones nobody would think to
 * check by looking at the screen.
 *
 * The same function disables the button and refuses the request, so a gate that
 * is wrong here is wrong in both places at once. That is the point of testing
 * it rather than the two call sites.
 */

function engagement(
  overrides: Partial<CertifierEngagementDetail> = {},
): CertifierEngagementDetail {
  return {
    id: "engagement-1",
    projectId: "project-1",
    documents: [],
    outreaches: [],
    alerts: [],
    emails: [],
    planningCertificate: null,
    ...overrides,
  } as unknown as CertifierEngagementDetail;
}

function architect(overrides: Record<string, unknown> = {}) {
  return {
    id: "outreach-architect",
    party: CompliancePartyType.ARCHITECT,
    mode: ComplianceOutreachMode.OUTREACH,
    status: ComplianceOutreachStatus.SENT,
    contactEmail: "studio@example.com",
    clientPlansApprovedAt: null,
    meetings: [],
    revisions: [],
    emails: [],
    ...overrides,
  };
}

function openAlert(type: ComplianceAlertType) {
  return { id: `alert-${type}`, type, status: ComplianceAlertStatus.OPEN };
}

// ---------------------------------------------------------------------------
// Client approval
// ---------------------------------------------------------------------------

test("an engaged architect holds the send until the client signs off", () => {
  const file = engagement({ outreaches: [architect()] as never });

  assert.equal(clientHasApprovedPlans(file), false);
  assert.match(
    packSendBlockedReason(file) ?? "",
    /client has not approved the preliminary plans/i,
  );
});

test("an approval releases it", () => {
  const file = engagement({
    outreaches: [
      architect({ clientPlansApprovedAt: new Date("2026-06-01T09:00:00Z") }),
    ] as never,
  });

  assert.equal(clientHasApprovedPlans(file), true);
  assert.equal(packSendBlockedReason(file), null);
});

// The gate exists to stop a certifier assessing a design the client is about to
// change. Where the client supplied the drawings there is nobody to ask — they
// are the client, and supplying them is approving them. Worse, the control that
// would record an approval lives on an architect card that a self-supplied file
// never renders, so gating on it held the send shut behind a button the tab
// does not offer.
test("documents the client supplied need no approval — there is nobody to ask", () => {
  const file = engagement({
    outreaches: [
      architect({
        mode: ComplianceOutreachMode.SELF_SUPPLIED,
        status: ComplianceOutreachStatus.NOT_SENT,
        contactEmail: null,
      }),
    ] as never,
  });

  assert.equal(clientHasApprovedPlans(file), true);
  assert.equal(packSendBlockedReason(file), null);
});

test("a file with no architect at all is not held either", () => {
  assert.equal(clientHasApprovedPlans(engagement()), true);
  assert.equal(packSendBlockedReason(engagement()), null);
});

// ---------------------------------------------------------------------------
// The alerts that stop the send
// ---------------------------------------------------------------------------

test("a stale title search stops the send", () => {
  const file = engagement({
    alerts: [openAlert(ComplianceAlertType.STALE_TITLE_SEARCH)] as never,
  });

  assert.match(
    packSendBlockedReason(file) ?? "",
    /does not name the current owners/i,
  );
});

test("a resolved title search alert stops nothing", () => {
  const file = engagement({
    alerts: [
      {
        ...openAlert(ComplianceAlertType.STALE_TITLE_SEARCH),
        status: ComplianceAlertStatus.RESOLVED,
      },
    ] as never,
  });

  assert.equal(packSendBlockedReason(file), null);
});

test("a job that needs a DA cannot be sent as a CDC, and says so first", () => {
  // Both conditions open. The DA is the one reported, because it is the only
  // one that makes the send pointless rather than premature — fixing the title
  // search would not make this job assessable as complying development.
  const file = engagement({
    alerts: [
      openAlert(ComplianceAlertType.DA_APPROVAL_REQUIRED),
      openAlert(ComplianceAlertType.STALE_TITLE_SEARCH),
    ] as never,
  });

  assert.match(packSendBlockedReason(file) ?? "", /development approval/i);
});
