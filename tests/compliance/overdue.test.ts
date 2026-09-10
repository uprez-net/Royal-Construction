import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
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
    externalApplications: [],
    ...overrides,
  } as unknown as CertifierEngagementDetail;
}

/**
 * One application to an outside body.
 *
 * The 10.7 certificate by default, because it is the one four of these tests
 * are about and naming it in each of them would bury what they vary.
 */
function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "application-1",
    kind: ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
    alreadyHeld: false,
    appliedAt: null,
    applicationRef: null,
    lodgedWith: null,
    receivedAt: null,
    ...overrides,
  };
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
    wasteManagementRequestedAt: null,
    emails: [],
    meetings: [],
    revisions: [],
    deliverables: [],
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
    externalApplications: [
      application({ appliedAt: MONDAY, applicationRef: "PC-123" }),
    ] as never,
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
    externalApplications: [application({ appliedAt: MONDAY })] as never,
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

const daAlert = [
  {
    id: "alert-da",
    type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
    status: ComplianceAlertStatus.OPEN,
  },
];

test("a DA with no certificate ordered has nothing to chase", () => {
  const file = engagement({ alerts: daAlert as never });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
    ),
  );
});

test("a certificate lodged for a DA is still chased when it runs late", () => {
  // The correction the DA work made. The certificate leaves the certifier's
  // pack when a job changes path, and it used to leave the file with it — so a
  // 10.7 lodged for the development application itself sat with the portal for
  // a month with nothing anywhere saying so. The council assesses a DA against
  // the same zoning and the same overlays; the certificate moved, it did not go.
  const file = engagement({
    alerts: daAlert as never,
    externalApplications: [application({ appliedAt: MONDAY })] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    raisedTypes(result).includes(
      ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
    ),
  );
});

// ---------------------------------------------------------------------------
// The other three portals, and the development application itself
// ---------------------------------------------------------------------------

test("each portal application is chased against its own turnaround", () => {
  // Ten working days. Past the levy's five and inside the road opening's ten,
  // which is the pair worth pinning: a shared threshold would have flagged both
  // or neither, and the whole point of the table is that they differ.
  const file = engagement({
    externalApplications: [
      application({
        kind: ComplianceExternalApplicationKind.LONG_SERVICE_LEVY,
        appliedAt: MONDAY,
      }),
      application({
        kind: ComplianceExternalApplicationKind.ROAD_OPENING,
        appliedAt: MONDAY,
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, sydney("2026-06-16T09:00:00"));

  assert.ok(
    raisedTypes(result).includes(ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED),
  );
  assert.equal(
    raisedTypes(result).includes(ComplianceAlertType.ROAD_OPENING_DELAYED),
    false,
  );
});

test("a development application is not late at eleven working days", () => {
  // The threshold that keeps the panel readable. Every other wait on this file
  // is eleven days or fewer; a DA runs weeks to months, and an alert on the
  // consultants' threshold would be open on every application ever lodged.
  const file = engagement({
    externalApplications: [
      application({
        kind: ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
        appliedAt: MONDAY,
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.equal(
    raisedTypes(result).includes(ComplianceAlertType.DA_DETERMINATION_OVERDUE),
    false,
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

test("a consultant engaged off the development application is still chased", () => {
  // The silent one. A consultant commissioned from the DA list has no certifier
  // checklist to hang a line on, so `startPartyOutreach` writes deliverables
  // carrying a document type and a null `checklistDocumentId`. Reading only the
  // checklist rows produced an empty target set, `[].every()` returned true,
  // and the sweep closed the alert with "Their documents came through" over a
  // consultant who had sent nothing at all — which is the one failure on this
  // file with nothing left on screen to contradict it.
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.TRAFFIC_CONSULTANT, {
        checklistDocumentId: null,
        deliverables: [
          {
            id: "deliverable-1",
            documentType: ComplianceDocumentType.TRAFFIC_CONTROL_PLAN,
            checklistDocumentId: null,
          },
        ],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    raisedTypes(result).includes(ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE),
  );
  assert.equal(
    resolvedTypes(result).includes(
      ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE,
    ),
    false,
  );
});

test("a type-only deliverable is settled by a document of that type", () => {
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.TRAFFIC_CONSULTANT, {
        checklistDocumentId: null,
        deliverables: [
          {
            id: "deliverable-1",
            documentType: ComplianceDocumentType.TRAFFIC_CONTROL_PLAN,
            checklistDocumentId: null,
          },
        ],
      }),
    ] as never,
    documents: [
      document(ComplianceDocumentType.TRAFFIC_CONTROL_PLAN),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE,
    ),
  );
});

test("one outstanding deliverable of three keeps the consultant late", () => {
  // A structural engineer answers three lines off one engagement. Two in and
  // one missing is still late, which is the whole reason the deliverables table
  // replaced the single column.
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.STRUCTURAL_ENGINEER, {
        checklistDocumentId: null,
        deliverables: [
          {
            id: "d-1",
            documentType: ComplianceDocumentType.STRUCTURAL_DRAWINGS,
            checklistDocumentId: "item-drawings",
          },
          {
            id: "d-2",
            documentType: ComplianceDocumentType.GEOTECH_REPORT,
            checklistDocumentId: "item-geotech",
          },
        ],
      }),
    ] as never,
    documents: [
      document(ComplianceDocumentType.CHECKLIST_ITEM, { id: "item-drawings" }),
      document(ComplianceDocumentType.CHECKLIST_ITEM, {
        id: "item-geotech",
        status: ComplianceDocumentStatus.PENDING,
        files: [],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    raisedTypes(result).includes(
      ComplianceAlertType.STRUCTURAL_RESPONSE_OVERDUE,
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

// ---------------------------------------------------------------------------
// The estate developer, and the rework a refusal from them causes
//
// Two clocks on one report that are never both running. The interesting cases
// are the handovers between them: a rejection has to stop chasing the developer
// and start chasing the consultant, and the revised report has to stop chasing
// the consultant without silently restarting the developer's clock from an
// engagement date months old.
// ---------------------------------------------------------------------------

test("a developer inside their quoted turnaround is not chased", () => {
  const file = engagement({
    outreaches: [outreach(CompliancePartyType.DEVELOPER)] as never,
  });

  const result = assessOverdueConditions(file, ELEVEN_WORKING_DAYS_LATER);

  assert.equal(
    raisedTypes(result).includes(
      ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    ),
    false,
  );
});

test("a developer past their turnaround with no verdict is chased", () => {
  const file = engagement({
    outreaches: [outreach(CompliancePartyType.DEVELOPER)] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    raisedTypes(result).includes(
      ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    ),
  );
});

test("a developer who has approved is not chased", () => {
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.DEVELOPER, {
        approvalDecision: "APPROVED",
        approvalDecidedAt: MONDAY,
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    ),
  );
});

test("a developer who has rejected is not chased either", () => {
  // The handover. A rejection is still an answer, and the wait has moved to the
  // consultant — chasing the developer here points the alert at the one party
  // who has already done what was asked of them.
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.DEVELOPER, {
        approvalDecision: "REJECTED",
        approvalDecidedAt: MONDAY,
        approvalReason: "Roof material is not compliant at BAL-29.",
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    ),
  );
  assert.equal(
    raisedTypes(result).includes(
      ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    ),
    false,
  );
});

test("a bushfire revision past its threshold chases the consultant", () => {
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.BUSHFIRE_CONSULTANT, {
        revisions: [{ id: "round-1", requestedAt: MONDAY, respondedAt: null }],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    raisedTypes(result).includes(
      ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
    ),
  );
});

test("the revision clock runs from the refusal, not from the engagement", () => {
  // The reason the round is a row rather than a flag. This consultant was
  // engaged on the Monday and the developer refused the report on the Monday
  // twelve working days later; the rework is one day old and is not late,
  // however long ago the engagement was.
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.BUSHFIRE_CONSULTANT, {
        sentAt: MONDAY,
        revisions: [
          {
            id: "round-1",
            requestedAt: TWELVE_WORKING_DAYS_LATER,
            respondedAt: null,
          },
        ],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(
    file,
    sydney("2026-06-19T09:00:00"),
  );

  assert.equal(
    raisedTypes(result).includes(
      ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
    ),
    false,
  );
});

test("a revision that has been answered stops being chased", () => {
  const file = engagement({
    outreaches: [
      outreach(CompliancePartyType.BUSHFIRE_CONSULTANT, {
        revisions: [
          {
            id: "round-1",
            requestedAt: MONDAY,
            respondedAt: ELEVEN_WORKING_DAYS_LATER,
          },
        ],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    resolvedTypes(result).includes(
      ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
    ),
  );
});

test("a file with no developer raises neither of their alerts", () => {
  // Most jobs. The lot is not in a covenanted estate, nobody is ever asked, and
  // an alert here would be permanent on every project in the system.
  const result = assessOverdueConditions(engagement(), TWELVE_WORKING_DAYS_LATER);

  assert.equal(
    raisedTypes(result).includes(
      ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    ),
    false,
  );
  assert.equal(
    raisedTypes(result).includes(
      ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Resubmission rounds
//
// The reason the rounds are a table. An application that was sent back and
// lodged again is under assessment from the day it went back in, and measuring
// from the original lodgement had every resubmitted DA permanently overdue from
// the moment somebody acted on the council's request.
// ---------------------------------------------------------------------------

test("an application with no rounds still measures from its lodgement date", () => {
  // Every application already on the system. The rounds table did not exist
  // when they were lodged, so the fallback is what keeps their clocks running
  // at all.
  const file = engagement({
    externalApplications: [
      application({ appliedAt: MONDAY, submissions: [] }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    raisedTypes(result).includes(
      ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
    ),
  );
});

test("the clock restarts from the round the application was last lodged in", () => {
  // Lodged on the Monday and resubmitted twelve working days later. The
  // certificate is one day into round two and is not late, however long ago
  // round one went in.
  const file = engagement({
    externalApplications: [
      application({
        appliedAt: MONDAY,
        submissions: [
          { round: 2, submittedAt: TWELVE_WORKING_DAYS_LATER, applicationRef: null },
          { round: 1, submittedAt: MONDAY, applicationRef: null },
        ],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, sydney("2026-06-19T09:00:00"));

  assert.equal(
    raisedTypes(result).includes(
      ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
    ),
    false,
  );
});

test("a late round says which round it is", () => {
  // So the chase reads as "round 2 is late" rather than implying the council
  // has sat on one application since March.
  const file = engagement({
    externalApplications: [
      application({
        appliedAt: sydney("2026-01-05T09:00:00"),
        submissions: [
          { round: 2, submittedAt: MONDAY, applicationRef: "PC-2026/778" },
        ],
      }),
    ] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  const alert = result.raise.find(
    (entry) => entry.type === ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
  );
  assert.ok(alert);
  assert.match(alert.detail, /Resubmitted \(round 2\)/);
  assert.match(alert.detail, /PC-2026\/778/);
});
