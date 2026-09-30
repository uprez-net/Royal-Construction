import assert from "node:assert/strict";

import {
  ComplianceAlertType,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceMeetingStatus,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
  CertifierEngagementStatus,
} from "@prisma/client";
import { test } from "vitest";

import { coveringDocumentType } from "@/constants/complianceDocuments";
import { assessOverdueConditions } from "@/lib/domain/compliance/overdue";
import {
  applicableRequiredDocuments,
  hasArchitectPlansOnFile,
  isCoveredOnFile,
  isRequiredPackComplete,
  missingOutreachDocuments,
} from "@/lib/domain/compliance/required-pack";
import { complianceStageFlow } from "@/lib/domain/compliance/stage-flow";
import type { CertifierEngagementDetail } from "@/types/compliance";

/**
 * A full architectural design on the file stands in for the preliminary plans.
 *
 * The two are the same building at two stages. A job that arrives with the
 * design already developed has no preliminary set and never will, and the pack
 * treated the two as unrelated: the outreach was refused over the preliminary
 * plans for good, the architect read as still drawing, and the sweep chased
 * them for a set that was never coming.
 *
 * Dates match `overdue.test.ts` so a threshold reads the same in both.
 */

const sydney = (value: string) => new Date(`${value}+10:00`);
const MONDAY = sydney("2026-06-01T09:00:00");
const FOUR_WORKING_DAYS_LATER = sydney("2026-06-05T09:00:00");
const TWELVE_WORKING_DAYS_LATER = sydney("2026-06-18T09:00:00");

const PRELIMINARY = ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS;
const FULL_DESIGN = ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN;

function engagement(
  overrides: Partial<CertifierEngagementDetail> = {},
): CertifierEngagementDetail {
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

function document(
  documentType: ComplianceDocumentType,
  { withFile = true, at = MONDAY }: { withFile?: boolean; at?: Date } = {},
) {
  return {
    id: `document-${documentType}`,
    documentType,
    status: withFile
      ? ComplianceDocumentStatus.UPLOADED
      : ComplianceDocumentStatus.PENDING,
    files: withFile
      ? [
          {
            id: `file-${documentType}`,
            url: `https://blob/${documentType}.pdf`,
            createdAt: at,
          },
        ]
      : [],
    createdAt: MONDAY,
    detail: null,
    label: null,
    order: 0,
  };
}

/** Everything the outreach waits for except the architect's plans. */
const REST_OF_PACK = [
  ComplianceDocumentType.DEPOSITED_PLAN,
  ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL,
  ComplianceDocumentType.SURVEY,
  ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
].map((type) => document(type));

function withDocuments(...documents: ReturnType<typeof document>[]) {
  return engagement({ documents: documents as never });
}

function architectAfterMeeting() {
  return {
    id: "outreach-architect",
    party: CompliancePartyType.ARCHITECT,
    mode: ComplianceOutreachMode.OUTREACH,
    status: ComplianceOutreachStatus.SENT,
    sentAt: MONDAY,
    contactEmail: "studio@example.com",
    contactName: "A Studio",
    checklistDocumentId: null,
    clientPlansApprovedAt: null,
    lastFollowUpAt: null,
    wasteManagementRequestedAt: null,
    approvalDecision: null,
    emails: [],
    meetings: [
      {
        id: "meeting-1",
        status: ComplianceMeetingStatus.HELD,
        scheduledFor: MONDAY,
        heldAt: MONDAY,
      },
    ],
    revisions: [],
    deliverables: [],
  };
}

const types = (file: CertifierEngagementDetail) =>
  applicableRequiredDocuments(file).map((required) => required.type);

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test("the full design is what covers the preliminary plans, and nothing covers the full design", () => {
  assert.equal(coveringDocumentType(PRELIMINARY), FULL_DESIGN);
  assert.equal(coveringDocumentType(FULL_DESIGN), null);
});

test("a full design with no preliminary plans covers them", () => {
  const file = withDocuments(document(FULL_DESIGN));

  assert.equal(isCoveredOnFile(file, PRELIMINARY), true);
  assert.equal(types(file).includes(PRELIMINARY), false);
  // The full design is the one doing the covering, so it stays on the pack.
  assert.equal(types(file).includes(FULL_DESIGN), true);
});

// Read one way only. A preliminary set that is on the file is what it is, and
// the full design arriving later does not take it off the pack.
test("preliminary plans on the file are not covered by anything", () => {
  const file = withDocuments(document(PRELIMINARY), document(FULL_DESIGN));

  assert.equal(isCoveredOnFile(file, PRELIMINARY), false);
  assert.equal(types(file).includes(PRELIMINARY), true);
});

// A seeded row with nothing on it is not a full design. Covering off the row
// alone would open the send on a document nobody has supplied.
test("an empty full design row covers nothing", () => {
  const file = withDocuments(document(FULL_DESIGN, { withFile: false }));

  assert.equal(isCoveredOnFile(file, PRELIMINARY), false);
  assert.equal(types(file).includes(PRELIMINARY), true);
});

// ---------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------

test("a pack with the full design and no preliminary plans is ready to send", () => {
  const file = withDocuments(...REST_OF_PACK, document(FULL_DESIGN));

  assert.deepEqual(missingOutreachDocuments(file), []);
  assert.equal(isRequiredPackComplete(file), true);
});

test("a pack with neither set is still waiting on the preliminary plans", () => {
  const file = withDocuments(...REST_OF_PACK);

  assert.deepEqual(
    missingOutreachDocuments(file).map((required) => required.type),
    [PRELIMINARY],
  );
  assert.equal(isRequiredPackComplete(file), false);
});

// ---------------------------------------------------------------------------
// The architect's clocks
// ---------------------------------------------------------------------------

test("either set counts as the architect's plans being in", () => {
  assert.equal(hasArchitectPlansOnFile(withDocuments()), false);
  assert.equal(
    hasArchitectPlansOnFile(withDocuments(document(PRELIMINARY))),
    true,
  );
  assert.equal(
    hasArchitectPlansOnFile(withDocuments(document(FULL_DESIGN))),
    true,
  );
});

// The sweep used to read the preliminary row alone, so an architect who
// delivered the full design was chased for preliminary plans every night.
test("the sweep does not chase preliminary plans the full design covers", () => {
  const file = engagement({
    documents: [document(FULL_DESIGN)] as never,
    outreaches: [architectAfterMeeting()] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.equal(
    result.raise.some(
      (alert) => alert.type === ComplianceAlertType.ARCHITECT_PLANS_OVERDUE,
    ),
    false,
  );
  const resolved = result.resolve.find(
    (entry) => entry.type === ComplianceAlertType.ARCHITECT_PLANS_OVERDUE,
  );
  assert.ok(resolved);
  assert.match(resolved.note, /full architectural design/i);
});

test("the sweep still chases an architect with neither set", () => {
  const file = engagement({
    outreaches: [architectAfterMeeting()] as never,
  });

  const result = assessOverdueConditions(file, TWELVE_WORKING_DAYS_LATER);

  assert.ok(
    result.raise.some(
      (alert) => alert.type === ComplianceAlertType.ARCHITECT_PLANS_OVERDUE,
    ),
  );
});

test("the architect stage finishes when the full design lands in place of the preliminary plans", () => {
  const stages = complianceStageFlow(
    engagement({
      documents: [
        ...REST_OF_PACK,
        document(FULL_DESIGN, { at: FOUR_WORKING_DAYS_LATER }),
      ] as never,
      outreaches: [architectAfterMeeting()] as never,
    }),
    TWELVE_WORKING_DAYS_LATER,
  );

  const architect = stages.find((entry) => entry.id === "ARCHITECT");
  assert.ok(architect);
  assert.equal(architect.state, "done");
  // Settled when the full design arrived, which is what ended the wait.
  assert.deepEqual(architect.settledAt, FOUR_WORKING_DAYS_LATER);
});
