import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceMeetingStatus,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";

import { assessOverdueConditions } from "../../lib/compliance/overdue";
import type { CertifierEngagementDetail } from "../../types/compliance";

/**
 * The nightly sweep, pinned at its boundaries.
 *
 * These are worth testing because the failure is invisible in both directions.
 * Raise a day early and every alert on the system fires through a long weekend,
 * the panel fills with things that are not actually late, and people stop
 * reading it. Fail to close one and a condition that was answered a fortnight
 * ago is still on screen, which does the same damage more slowly.
 *
 * Dates are Sydney instants throughout, and the surrounding week is chosen to
 * have no public holiday in it so the arithmetic in a test says what it looks
 * like it says. `lib/dates/business-days` has its own tests for the holidays.
 */

const sydney = (value: string) => new Date(`${value}+10:00`);

/** Monday 1 June 2026, and the working days that follow it. */
const MONDAY = sydney("2026-06-01T09:00:00");
/** Twelve working days later, skipping the King's Birthday on the 8th. */
const TWELVE_WORKING_DAYS_LATER = sydney("2026-06-18T09:00:00");
const ELEVEN_WORKING_DAYS_LATER = sydney("2026-06-17T09:00:00");

type Overrides = Partial<CertifierEngagementDetail>;

/**
 * The smallest engagement the assessment will read.
 *
 * Cast at the boundary rather than built in full: the function reads four
 * relations and a handful of scalars, and constructing every column of five
 * Prisma models would bury what each test is actually varying.
 */
function engagement(overrides: Overrides = {}): CertifierEngagementDetail {
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

function outreach(
  party: CompliancePartyType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `outreach-${party}`,
    party,
    mode: ComplianceOutreachMode.OUTREACH,
    status: ComplianceOutreachStatus.SENT,
    sentAt: MONDAY,
    contactEmail: "firm@example.com",
    contactName: "A Firm",
    checklistDocumentId: null,
    clientPlansApprovedAt: null,
    lastFollowUpAt: null,
    emails: [],
    meetings: [],
    revisions: [],
    ...overrides,
  };
}

function document(
  documentType: ComplianceDocumentType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `document-${documentType}`,
    documentType,
    status: ComplianceDocumentStatus.UPLOADED,
    files: [{ id: "file-1", url: "https://blob/one.pdf" }],
    detail: null,
    label: null,
    order: 0,
    ...overrides,
  };
}

const raisedTypes = (result: ReturnType<typeof assessOverdueConditions>) =>
  result.raise.map((alert) => alert.type);
const resolvedTypes = (result: ReturnType<typeof assessOverdueConditions>) =>
  result.resolve.map((entry) => entry.type);

// ---------------------------------------------------------------------------
// The surveyor
// ---------------------------------------------------------------------------

test("a surveyor inside their quoted turnaround is not chased", () => {
  const file = engagement({
    outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
  });

  const result = assessOverdueConditions(file, ELEVEN_WORKING_DAYS_LATER);

  assert.equal(
    raisedTypes(result).includes(ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE),
    false,
  );
  // Not resolved either. The clock only moves forward, so an alert raised on a
  // previous run must not be closed by the day before the threshold.
  assert.equal(
    resolvedTypes(result).includes(
      ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE,
    ),
    false,
  );
});

test("a surveyor past their quoted turnaround is chased", () => {
  const file = engagement({
    outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    raisedTypes(result).includes(ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE),
  );
});

test("a surveyor who has sent everything is closed out, however late", () => {
  const file = engagement({
    outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
    documents: [
      document(ComplianceDocumentType.DEPOSITED_PLAN),
      document(ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL),
      document(ComplianceDocumentType.SURVEY),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE,
    ),
  );
  assert.equal(
    raisedTypes(result).includes(ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE),
    false,
  );
});

test("documents the client supplied leave nobody to chase", () => {
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.SURVEYOR, {
        mode: ComplianceOutreachMode.SELF_SUPPLIED,
        status: ComplianceOutreachStatus.NOT_SENT,
        sentAt: null,
        contactEmail: null,
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE,
    ),
  );
});

// ---------------------------------------------------------------------------
// The planning certificate
// ---------------------------------------------------------------------------

test("a lodged application past the portal's turnaround is flagged", () => {
  const file = engagement({
    planningCertificate: {
      alreadyHeld: false,
      appliedAt: MONDAY,
      applicationRef: "PC-123",
      receivedAt: null,
    } as never,
  });

  // Six working days: the portal quotes three to five.
  const result = assessOverdueConditions(file, sydney("2026-06-10T09:00:00"));

  assert.ok(
    raisedTypes(result).includes(
      ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
    ),
  );
  // The application number goes in the detail, because chasing it means ringing
  // the council and quoting it.
  assert.ok(
    result.raise
      .find(
        (alert) =>
          alert.type === ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
      )
      ?.detail.includes("PC-123"),
  );
});

test("a certificate on the file closes the wait even if nobody ticked it", () => {
  const file = engagement({
    planningCertificate: {
      alreadyHeld: false,
      appliedAt: MONDAY,
      receivedAt: null,
    } as never,
    documents: [
      document(ComplianceDocumentType.PLANNING_CERTIFICATE_10_7),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
    ),
  );
});

test("a DA takes the certificate out of the pack, so it cannot be late", () => {
  const file = engagement({
    planningCertificate: {
      alreadyHeld: false,
      appliedAt: MONDAY,
      receivedAt: null,
    } as never,
    alerts: [
      {
        id: "alert-da",
        type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
        status: ComplianceAlertStatus.OPEN,
      },
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
    ),
  );
});

// ---------------------------------------------------------------------------
// The architect
// ---------------------------------------------------------------------------

test("the plans clock starts at the meeting, not at the outreach", () => {
  // Engaged on the Monday, but nobody has met yet. Twelve working days later
  // the architect is not late, because they have nothing to draw from.
  const file = engagement({
    outreaches: [outreach(CompliancePartyType.ARCHITECT)] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.equal(
    raisedTypes(result).includes(ComplianceAlertType.ARCHITECT_PLANS_OVERDUE),
    false,
  );
  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.ARCHITECT_PLANS_OVERDUE,
    ),
  );
});

test("plans overdue is measured from when the meeting was held", () => {
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.ARCHITECT, {
        meetings: [
          {
            id: "meeting-1",
            status: ComplianceMeetingStatus.HELD,
            scheduledFor: MONDAY,
            heldAt: MONDAY,
          },
        ],
      }),
    ] as never,
  });

  assert.equal(
    raisedTypes(
      assessOverdueConditions(file, ELEVEN_WORKING_DAYS_LATER),
    ).includes(ComplianceAlertType.ARCHITECT_PLANS_OVERDUE),
    false,
  );
  assert.ok(
    raisedTypes(
      assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER),
    ).includes(ComplianceAlertType.ARCHITECT_PLANS_OVERDUE),
  );
});

test("a rescheduled meeting does not start the clock", () => {
  // The row that moved is history the moment its replacement exists. Counting
  // from it would make an architect late against a meeting that never happened.
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.ARCHITECT, {
        meetings: [
          {
            id: "meeting-2",
            status: ComplianceMeetingStatus.SCHEDULED,
            scheduledFor: TWELVE_WORKING_DAYS_LATER,
            heldAt: null,
          },
          {
            id: "meeting-1",
            status: ComplianceMeetingStatus.RESCHEDULED,
            scheduledFor: MONDAY,
            heldAt: null,
          },
        ],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.equal(
    raisedTypes(result).includes(ComplianceAlertType.ARCHITECT_PLANS_OVERDUE),
    false,
  );
});

test("an outstanding revision past its clock is chased; an answered one is not", () => {
  const withRevision = (respondedAt: Date | null) =>
    engagement({
      outreaches: [
        outreach(CompliancePartyType.ARCHITECT, {
          revisions: [
            {
              id: "revision-1",
              feedback: "Move the study to the north side.",
              requestedAt: MONDAY,
              respondedAt,
            },
          ],
        }),
      ] as never,
    });

  assert.ok(
    raisedTypes(
      assessOverdueConditions(withRevision(null), TWELVE_WORKING_DAYS_LATER),
    ).includes(ComplianceAlertType.ARCHITECT_REVISION_OVERDUE),
  );
  assert.ok(
    resolvedTypes(
      assessOverdueConditions(
        withRevision(ELEVEN_WORKING_DAYS_LATER),
        TWELVE_WORKING_DAYS_LATER,
      ),
    ).includes(ComplianceAlertType.ARCHITECT_REVISION_OVERDUE),
  );
});

// ---------------------------------------------------------------------------
// The consultants
// ---------------------------------------------------------------------------

test("a consultant is late against the checklist line they were engaged for", () => {
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.BASIX_CONSULTANT, {
        checklistDocumentId: "item-7",
      }),
    ] as never,
    documents: [
      document(ComplianceDocumentType.CHECKLIST_ITEM, {
        id: "item-7",
        status: ComplianceDocumentStatus.PENDING,
        files: [],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    raisedTypes(result).includes(ComplianceAlertType.BASIX_RESPONSE_OVERDUE),
  );
});

test("a checklist line marked not required finishes with the consultant", () => {
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.BUSHFIRE_CONSULTANT, {
        checklistDocumentId: "item-9",
      }),
    ] as never,
    documents: [
      document(ComplianceDocumentType.CHECKLIST_ITEM, {
        id: "item-9",
        status: ComplianceDocumentStatus.NOT_REQUIRED,
        files: [],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.BUSHFIRE_RESPONSE_OVERDUE,
    ),
  );
});

test("a checklist line that has gone since the outreach is not chased forever", () => {
  // A checklist re-extracted between engaging the consultant and their reply
  // rewrites its items. There is nothing on screen to chase against, so an
  // alert would point at a row that no longer exists.
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.BASIX_CONSULTANT, {
        checklistDocumentId: "item-gone",
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(ComplianceAlertType.BASIX_RESPONSE_OVERDUE),
  );
});
