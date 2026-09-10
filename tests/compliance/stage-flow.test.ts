import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CertifierEmailDirection,
  CertifierEngagementStatus,
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

import {
  complianceStageFlow,
  stageForAlert,
  type ComplianceStage,
  type ComplianceStageId,
} from "../../lib/compliance/stage-flow";
import type { CertifierEngagementDetail } from "../../types/compliance";

/**
 * The stage header, pinned where it would otherwise lie.
 *
 * Two failures are worth guarding against and neither is visible on screen. The
 * first is a clock that disagrees with the nightly sweep: this header counts
 * down to the same thresholds the sweep counts up to, and a header showing four
 * days left on the morning an alert is raised against that stage teaches people
 * that neither number means anything. The second is a stage that goes red or
 * green for the wrong reason -- a surveyor the client supplied reading as nine
 * days late, a checklist counted as finished because nobody has issued one.
 *
 * Dates match `overdue.test.ts` deliberately: the same week, the same holiday
 * skipped, so a threshold can be read against both files without re-deriving
 * the arithmetic.
 */

const sydney = (value: string) => new Date(`${value}+10:00`);

/** Monday 1 June 2026, and the working days that follow it. */
const MONDAY = sydney("2026-06-01T09:00:00");
/** Eleven working days later, skipping the King's Birthday on the 8th. */
const ELEVEN_WORKING_DAYS_LATER = sydney("2026-06-17T09:00:00");
const TWELVE_WORKING_DAYS_LATER = sydney("2026-06-18T09:00:00");
/** Four working days after the Monday. */
const FOUR_WORKING_DAYS_LATER = sydney("2026-06-05T09:00:00");

type Overrides = Partial<CertifierEngagementDetail>;

/**
 * The smallest engagement the flow will read.
 *
 * Cast at the boundary, as the sweep's own tests do: the function reads five
 * relations and one scalar, and building every column of six Prisma models
 * would bury what each test varies.
 */
function engagement(overrides: Overrides = {}): CertifierEngagementDetail {
  return {
    id: "engagement-1",
    projectId: "project-1",
    status: CertifierEngagementStatus.COLLECTING_DOCS,
    documents: [],
    outreaches: [],
    alerts: [],
    emails: [],
    externalApplications: [],
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
    approvalDecision: null,
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
    createdAt: MONDAY,
    detail: null,
    label: null,
    order: 0,
    ...overrides,
  };
}

function application(
  kind: ComplianceExternalApplicationKind,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `application-${kind}`,
    kind,
    alreadyHeld: false,
    appliedAt: null,
    applicationRef: null,
    lodgedWith: null,
    receivedAt: null,
    submissions: [],
    ...overrides,
  };
}

function alert(
  type: ComplianceAlertType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `alert-${type}`,
    type,
    status: ComplianceAlertStatus.OPEN,
    detail: null,
    raisedBySource: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: MONDAY,
    ...overrides,
  };
}

const stage = (stages: ComplianceStage[], id: ComplianceStageId) => {
  const found = stages.find((entry) => entry.id === id);
  assert.ok(found, `no ${id} stage`);
  return found;
};

// ---------------------------------------------------------------------------
// The shape of the flow
// ---------------------------------------------------------------------------

test("a file with no development application does not carry a DA stage", () => {
  const stages = complianceStageFlow(engagement(), MONDAY);

  assert.deepEqual(
    stages.map((entry) => entry.id),
    [
      "SURVEYOR",
      "ARCHITECT",
      "COUNCIL",
      "CERTIFIER",
      "CHECKLIST",
      "CERTIFICATE",
    ],
  );
});

test("a raised development approval puts the DA stage in the route", () => {
  const stages = complianceStageFlow(
    engagement({
      alerts: [alert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
    }),
    MONDAY,
  );

  assert.ok(stages.some((entry) => entry.id === "DEVELOPMENT_APPLICATION"));
});

test("exactly one stage is current, and it is the first unfinished one", () => {
  const stages = complianceStageFlow(
    engagement({
      outreaches: [
        outreach(CompliancePartyType.SURVEYOR, {
          mode: ComplianceOutreachMode.SELF_SUPPLIED,
        }),
      ] as never,
      documents: [
        document(ComplianceDocumentType.DEPOSITED_PLAN),
        document(ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL),
        document(ComplianceDocumentType.SURVEY),
      ] as never,
    }),
    MONDAY,
  );

  const current = stages.filter((entry) => entry.state === "current");
  assert.equal(current.length, 1);
  assert.equal(current[0].id, "ARCHITECT");
  assert.equal(stage(stages, "SURVEYOR").state, "done");
  assert.equal(stage(stages, "CHECKLIST").state, "upcoming");
});

// ---------------------------------------------------------------------------
// The clocks, against the sweep's own thresholds
// ---------------------------------------------------------------------------

test("a surveyor inside their quote has days left rather than days over", () => {
  const stages = complianceStageFlow(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
    }),
    FOUR_WORKING_DAYS_LATER,
  );

  const surveyor = stage(stages, "SURVEYOR");
  assert.equal(surveyor.elapsedBusinessDays, 4);
  assert.equal(surveyor.slaBusinessDays, 11);
  assert.equal(surveyor.daysLeft, 7);
});

test("the countdown reaches zero on the day the sweep still says nothing", () => {
  // The boundary the sweep is pinned at: eleven working days elapsed is not
  // late, twelve is. So the header must read "due today" here rather than
  // showing a day over, or it goes red before the alert exists.
  const stages = complianceStageFlow(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
    }),
    ELEVEN_WORKING_DAYS_LATER,
  );

  assert.equal(stage(stages, "SURVEYOR").daysLeft, 0);
});

test("a surveyor past their quote reads as days over", () => {
  const stages = complianceStageFlow(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
    }),
    TWELVE_WORKING_DAYS_LATER,
  );

  assert.equal(stage(stages, "SURVEYOR").daysLeft, -1);
});

test("a party the client supplied has no clock at all", () => {
  const stages = complianceStageFlow(
    engagement({
      outreaches: [
        outreach(CompliancePartyType.SURVEYOR, {
          mode: ComplianceOutreachMode.SELF_SUPPLIED,
        }),
      ] as never,
    }),
    TWELVE_WORKING_DAYS_LATER,
  );

  const surveyor = stage(stages, "SURVEYOR");
  assert.equal(surveyor.startedAt, null);
  assert.equal(surveyor.daysLeft, null);
});

test("a surveyor nobody has written to is not counted from anywhere", () => {
  // The failure this guards: counting from the engagement's own creation would
  // have every unstarted stage on a three-month-old file reading as months
  // overdue.
  const stages = complianceStageFlow(engagement(), TWELVE_WORKING_DAYS_LATER);

  assert.equal(stage(stages, "SURVEYOR").startedAt, null);
  assert.equal(stage(stages, "SURVEYOR").elapsedBusinessDays, null);
});

test("the architect's clock starts at the client meeting, not at the outreach", () => {
  const stages = complianceStageFlow(
    engagement({
      outreaches: [
        outreach(CompliancePartyType.ARCHITECT, {
          sentAt: MONDAY,
          meetings: [
            {
              id: "meeting-1",
              status: ComplianceMeetingStatus.HELD,
              scheduledFor: FOUR_WORKING_DAYS_LATER,
              heldAt: FOUR_WORKING_DAYS_LATER,
            },
          ],
        }),
      ] as never,
    }),
    ELEVEN_WORKING_DAYS_LATER,
  );

  const architect = stage(stages, "ARCHITECT");
  assert.deepEqual(architect.startedAt, FOUR_WORKING_DAYS_LATER);
  assert.equal(architect.slaBusinessDays, 11);
  // Seven working days since the meeting rather than eleven since the outreach.
  assert.equal(architect.elapsedBusinessDays, 7);
});

test("an architect with no meeting booked counts down nothing", () => {
  const stages = complianceStageFlow(
    engagement({
      outreaches: [outreach(CompliancePartyType.ARCHITECT)] as never,
    }),
    TWELVE_WORKING_DAYS_LATER,
  );

  const architect = stage(stages, "ARCHITECT");
  // Engaged, so the stage says how long it has been. Not counting down, because
  // an architect who has not sat with the owners has nothing to draw yet and
  // the sweep raises nothing against them either.
  assert.deepEqual(architect.startedAt, MONDAY);
  assert.equal(architect.slaBusinessDays, null);
  assert.equal(architect.daysLeft, null);
});

test("an outstanding revision takes the architect's clock back off the plans", () => {
  const stages = complianceStageFlow(
    engagement({
      documents: [
        // The surveyor's three, so the architect is the stage the flow is on
        // rather than one waiting behind an unfinished survey.
        document(ComplianceDocumentType.DEPOSITED_PLAN),
        document(ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL),
        document(ComplianceDocumentType.SURVEY),
        document(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS),
      ] as never,
      outreaches: [
        outreach(CompliancePartyType.SURVEYOR),
        outreach(CompliancePartyType.ARCHITECT, {
          meetings: [
            {
              id: "meeting-1",
              status: ComplianceMeetingStatus.HELD,
              scheduledFor: MONDAY,
              heldAt: MONDAY,
            },
          ],
          revisions: [
            {
              id: "revision-1",
              requestedAt: FOUR_WORKING_DAYS_LATER,
              respondedAt: null,
            },
          ],
        }),
      ] as never,
    }),
    ELEVEN_WORKING_DAYS_LATER,
  );

  const architect = stage(stages, "ARCHITECT");
  assert.equal(architect.state, "current");
  assert.deepEqual(architect.startedAt, FOUR_WORKING_DAYS_LATER);
  assert.equal(architect.slaBusinessDays, 11);
});

test("a lodged 10.7 counts against the portal's five days, not eleven", () => {
  const stages = complianceStageFlow(
    engagement({
      externalApplications: [
        application(
          ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
          { appliedAt: MONDAY },
        ),
      ] as never,
    }),
    FOUR_WORKING_DAYS_LATER,
  );

  const council = stage(stages, "COUNCIL");
  assert.equal(council.slaBusinessDays, 5);
  assert.equal(council.daysLeft, 1);
});

test("a resubmitted DA counts from the latest round", () => {
  // Measuring from `appliedAt` had every application that was ever sent back
  // permanently overdue from the moment somebody acted on the council's
  // request. The header must make the same correction the sweep makes.
  const stages = complianceStageFlow(
    engagement({
      alerts: [alert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
      externalApplications: [
        application(ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION, {
          appliedAt: sydney("2026-01-05T09:00:00"),
          submissions: [
            { id: "round-2", round: 2, submittedAt: MONDAY, applicationRef: null },
            {
              id: "round-1",
              round: 1,
              submittedAt: sydney("2026-01-05T09:00:00"),
              applicationRef: null,
            },
          ],
        }),
      ] as never,
    }),
    FOUR_WORKING_DAYS_LATER,
  );

  const da = stage(stages, "DEVELOPMENT_APPLICATION");
  assert.equal(da.elapsedBusinessDays, 4);
  assert.equal(da.slaBusinessDays, 60);
});

test("a development application nobody has lodged has no clock to run", () => {
  const stages = complianceStageFlow(
    engagement({
      alerts: [alert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
    }),
    TWELVE_WORKING_DAYS_LATER,
  );

  const da = stage(stages, "DEVELOPMENT_APPLICATION");
  assert.equal(da.startedAt, null);
  assert.equal(da.slaBusinessDays, null);
});

test("the certifier stage runs from the pack going out, and counts down nothing", () => {
  const stages = complianceStageFlow(
    engagement({
      emails: [
        {
          id: "email-1",
          direction: CertifierEmailDirection.OUTBOUND,
          sentAt: MONDAY,
        },
      ] as never,
    }),
    FOUR_WORKING_DAYS_LATER,
  );

  const certifier = stage(stages, "CERTIFIER");
  assert.deepEqual(certifier.startedAt, MONDAY);
  assert.equal(certifier.elapsedBusinessDays, 4);
  // No published turnaround, so no countdown and nothing that can go red on a
  // firm that is not late.
  assert.equal(certifier.slaBusinessDays, null);
  assert.equal(certifier.daysLeft, null);
});

test("the checklist clock runs from the earliest line, not the latest", () => {
  // A re-extraction rewrites the rows. Reading the newest would restart the
  // clock on a list that has been open a month.
  const stages = complianceStageFlow(
    engagement({
      documents: [
        document(ComplianceDocumentType.CHECKLIST_ITEM, {
          id: "item-2",
          createdAt: FOUR_WORKING_DAYS_LATER,
          files: [],
          status: ComplianceDocumentStatus.PENDING,
        }),
        document(ComplianceDocumentType.CHECKLIST_ITEM, {
          id: "item-1",
          createdAt: MONDAY,
          files: [],
          status: ComplianceDocumentStatus.PENDING,
        }),
      ] as never,
    }),
    ELEVEN_WORKING_DAYS_LATER,
  );

  assert.deepEqual(stage(stages, "CHECKLIST").startedAt, MONDAY);
});

test("a checklist nobody has issued is not finished with", () => {
  const stages = complianceStageFlow(engagement(), MONDAY);

  assert.notEqual(stage(stages, "CHECKLIST").state, "done");
});

// ---------------------------------------------------------------------------
// Which stage an alert reddens
// ---------------------------------------------------------------------------

test("an open alert reddens its own stage and no other", () => {
  const stages = complianceStageFlow(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
      alerts: [
        alert(ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE),
      ] as never,
    }),
    TWELVE_WORKING_DAYS_LATER,
  );

  assert.equal(stage(stages, "SURVEYOR").isOverdue, true);
  assert.equal(
    stages.filter((entry) => entry.isOverdue).length,
    1,
    "one alert must not redden the whole header",
  );
});

test("a resolved alert reddens nothing", () => {
  const stages = complianceStageFlow(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
      alerts: [
        alert(ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE, {
          status: ComplianceAlertStatus.RESOLVED,
          resolvedAt: MONDAY,
        }),
      ] as never,
    }),
    TWELVE_WORKING_DAYS_LATER,
  );

  assert.equal(stage(stages, "SURVEYOR").isOverdue, false);
});

test("every alert type lands on a stage that exists", () => {
  // The map is exhaustive by type, which the compiler checks. What it cannot
  // check is that the id it names is one the flow actually builds -- a typo
  // there is an alert that reddens nothing at all.
  const ids = new Set<ComplianceStageId>([
    "SURVEYOR",
    "ARCHITECT",
    "COUNCIL",
    "CERTIFIER",
    "DEVELOPMENT_APPLICATION",
    "CHECKLIST",
    "CERTIFICATE",
  ]);

  for (const type of Object.values(ComplianceAlertType)) {
    assert.ok(
      ids.has(stageForAlert(engagement(), type)),
      `${type} points at a stage that does not exist`,
    );
  }
});

test("every open alert reddens some node on the flow it is raised against", () => {
  // The guard the routing table cannot give on its own. `ALERT_STAGE` is
  // exhaustive over the enum, so a stage id is always produced -- but the flow
  // only builds a DEVELOPMENT_APPLICATION node on files that have one, and five
  // of the alerts routed there can be raised on a file that does not. Each of
  // those reddened nothing anywhere, on a file where something was genuinely
  // late.
  for (const type of Object.values(ComplianceAlertType)) {
    const file = engagement({ alerts: [alert(type)] as never });
    const stages = complianceStageFlow(file, MONDAY);
    const target = stageForAlert(file, type);

    assert.ok(
      stages.some((entry) => entry.id === target),
      `${type} routes to ${target}, which is not on this file's flow`,
    );
    assert.ok(
      stages.some((entry) => entry.isOverdue),
      `${type} reddens nothing`,
    );
  }
});

test("a levy late on a CDC reddens the checklist, not a DA that is not there", () => {
  // A CDC can buy a long service levy and a road opening permit; the sweep
  // raises those off the application rows alone, with no development
  // application anywhere on the file.
  const cdc = engagement({
    alerts: [alert(ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED)] as never,
  });

  assert.equal(
    stageForAlert(cdc, ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED),
    "CHECKLIST",
  );

  // And the DA once there is one, because that is where the row lives then.
  const withDa = engagement({
    alerts: [
      alert(ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED),
      alert(ComplianceAlertType.DA_APPROVAL_REQUIRED),
    ] as never,
  });

  assert.equal(
    stageForAlert(withDa, ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED),
    "DEVELOPMENT_APPLICATION",
  );
});

test("the developer's two alerts follow the same rule", () => {
  const noDa = engagement({});
  for (const type of [
    ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
  ]) {
    assert.equal(stageForAlert(noDa, type), "CHECKLIST");
  }
});

test("a consultant late on a frozen checklist reddens the DA instead", () => {
  // The one alert whose stage depends on the file rather than the type. While a
  // job waits on development approval the checklist is frozen and the same
  // consultants are commissioned from the DA list, so pointing the reader at
  // the checklist would point them at a block they cannot act in.
  const blocked = engagement({
    alerts: [alert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
  });

  assert.equal(
    stageForAlert(blocked, ComplianceAlertType.BASIX_RESPONSE_OVERDUE),
    "DEVELOPMENT_APPLICATION",
  );
  assert.equal(
    stageForAlert(engagement(), ComplianceAlertType.BASIX_RESPONSE_OVERDUE),
    "CHECKLIST",
  );
});
