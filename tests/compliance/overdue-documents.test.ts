import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";

import {
  isDocumentOverdue,
  overdueComplianceDocuments,
} from "../../lib/compliance/overdue-documents";
import type { CertifierEngagementDetail } from "../../types/compliance";

/**
 * Which rows a red badge lands on.
 *
 * Both directions do damage and only one of them is visible. A badge on the
 * wrong row sends somebody to chase a firm that is not late, or -- worse --
 * leaves the firm that is late looking fine, because the reader saw a red mark
 * on the file and dealt with the row it was on. A badge on a row that already
 * has its document is the one people notice, and it is the one that teaches
 * them to stop reading badges at all.
 *
 * So most of these are about what must *not* be marked.
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
    externalApplications: [],
    ...overrides,
  } as unknown as CertifierEngagementDetail;
}

function document(
  documentType: ComplianceDocumentType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `document-${documentType}`,
    documentType,
    status: ComplianceDocumentStatus.PENDING,
    files: [],
    detail: null,
    label: null,
    order: 0,
    ...overrides,
  };
}

const supplied = (
  documentType: ComplianceDocumentType,
  overrides: Record<string, unknown> = {},
) =>
  document(documentType, {
    status: ComplianceDocumentStatus.UPLOADED,
    files: [{ id: "file-1", url: "https://blob/one.pdf" }],
    ...overrides,
  });

function outreach(
  party: CompliancePartyType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `outreach-${party}`,
    party,
    mode: ComplianceOutreachMode.OUTREACH,
    status: ComplianceOutreachStatus.SENT,
    sentAt: new Date("2026-06-01T09:00:00+10:00"),
    contactEmail: "firm@example.com",
    checklistDocumentId: null,
    deliverables: [],
    emails: [],
    meetings: [],
    revisions: [],
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
    createdAt: new Date("2026-06-01T09:00:00+10:00"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The surveyor, who owes three documents off one alert
// ---------------------------------------------------------------------------

test("an overdue surveyor marks the documents they still owe", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
      documents: [
        supplied(ComplianceDocumentType.DEPOSITED_PLAN),
        document(ComplianceDocumentType.SURVEY),
      ] as never,
      alerts: [alert(ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE)] as never,
    }),
  );

  assert.ok(overdue.types.has(ComplianceDocumentType.SURVEY));
  assert.ok(overdue.types.has(ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL));
  // The one they already sent. A row carrying a document and an Overdue badge
  // is a row saying two things that cannot both be true.
  assert.equal(
    overdue.types.has(ComplianceDocumentType.DEPOSITED_PLAN),
    false,
  );
});

test("a line marked not required is answered, not late", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
      documents: [
        document(ComplianceDocumentType.SURVEY, {
          status: ComplianceDocumentStatus.NOT_REQUIRED,
        }),
      ] as never,
      alerts: [alert(ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE)] as never,
    }),
  );

  assert.equal(overdue.types.has(ComplianceDocumentType.SURVEY), false);
});

test("a resolved alert marks nothing", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
      alerts: [
        alert(ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE, {
          status: ComplianceAlertStatus.RESOLVED,
        }),
      ] as never,
    }),
  );

  assert.equal(overdue.types.size, 0);
  assert.equal(overdue.documentIds.size, 0);
});

test("a rejected row is outstanding, though it still holds a file", () => {
  // The badge this exists for. A rejection puts the row back to PENDING and
  // records the reason while the refused file stays attached — it is the only
  // evidence of what was tried. Reading the file count alone called that
  // settled, which suppressed the revision badges entirely: the architect
  // redrawing plans the client sent back, and the bushfire consultant
  // reissuing a report the developer refused.
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.ARCHITECT)] as never,
      documents: [
        supplied(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS, {
          status: ComplianceDocumentStatus.PENDING,
          rejectionReason: "The client wants the garage moved.",
        }),
      ] as never,
      alerts: [alert(ComplianceAlertType.ARCHITECT_REVISION_OVERDUE)] as never,
    }),
  );

  assert.ok(
    overdue.types.has(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS),
  );
});

test("the replacement clears the badge with the rejection", () => {
  // The reason is cleared in the same write that supersedes the file, so the
  // two move together and the badge goes with them.
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.ARCHITECT)] as never,
      documents: [
        supplied(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS, {
          rejectionReason: null,
        }),
      ] as never,
      alerts: [alert(ComplianceAlertType.ARCHITECT_REVISION_OVERDUE)] as never,
    }),
  );

  assert.equal(
    overdue.types.has(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS),
    false,
  );
});

test("a rejected line marked not required is still answered", () => {
  // Not required beats a rejection: somebody has decided the job does not want
  // this at all, which settles it however it got there.
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.ARCHITECT)] as never,
      documents: [
        supplied(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS, {
          status: ComplianceDocumentStatus.NOT_REQUIRED,
          rejectionReason: "Superseded.",
        }),
      ] as never,
      alerts: [alert(ComplianceAlertType.ARCHITECT_REVISION_OVERDUE)] as never,
    }),
  );

  assert.equal(
    overdue.types.has(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS),
    false,
  );
});

// ---------------------------------------------------------------------------
// The alerts that are not about a late document at all
// ---------------------------------------------------------------------------

test("a stale title search marks nothing, though it names a surveyor", () => {
  // The document is on the file, on time, and wrong. The alert already says
  // that in a sentence; a badge saying "Overdue" on the row would contradict
  // the file it is sitting on.
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
      documents: [
        supplied(ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL),
      ] as never,
      alerts: [alert(ComplianceAlertType.STALE_TITLE_SEARCH)] as never,
    }),
  );

  assert.equal(overdue.types.size, 0);
});

test("a development approval requirement marks nothing", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      alerts: [alert(ComplianceAlertType.DA_APPROVAL_REQUIRED)] as never,
    }),
  );

  assert.equal(overdue.types.size, 0);
});

// ---------------------------------------------------------------------------
// The architect, who owns two rows and is only ever late with one
// ---------------------------------------------------------------------------

test("late plans do not put a badge on the full design", () => {
  // The sweep stops the plans clock when the preliminary set lands and never
  // waits for the full design at all -- the pack goes without it. Marking by
  // party would redden a drawing set nobody is waiting for.
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.ARCHITECT)] as never,
      alerts: [alert(ComplianceAlertType.ARCHITECT_PLANS_OVERDUE)] as never,
    }),
  );

  assert.ok(
    overdue.types.has(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS),
  );
  assert.equal(
    overdue.types.has(ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN),
    false,
  );
});

test("a late waste management plan marks the plan, not the architect's drawings", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [outreach(CompliancePartyType.ARCHITECT)] as never,
      alerts: [
        alert(ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE),
      ] as never,
    }),
  );

  assert.ok(overdue.types.has(ComplianceDocumentType.WASTE_MANAGEMENT_PLAN));
  assert.equal(
    overdue.types.has(ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS),
    false,
  );
});

// ---------------------------------------------------------------------------
// The consultants, who answer checklist lines rather than pack rows
// ---------------------------------------------------------------------------

test("a late consultant marks the lines they were engaged against, by id", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [
        outreach(CompliancePartyType.STRUCTURAL_ENGINEER, {
          deliverables: [
            { id: "d-1", checklistDocumentId: "item-drawings" },
            { id: "d-2", checklistDocumentId: "item-geotech" },
          ],
        }),
      ] as never,
      documents: [
        supplied(ComplianceDocumentType.CHECKLIST_ITEM, { id: "item-drawings" }),
        document(ComplianceDocumentType.CHECKLIST_ITEM, { id: "item-geotech" }),
        document(ComplianceDocumentType.CHECKLIST_ITEM, { id: "item-other" }),
      ] as never,
      alerts: [
        alert(ComplianceAlertType.STRUCTURAL_RESPONSE_OVERDUE),
      ] as never,
    }),
  );

  // The one they still owe.
  assert.deepEqual([...overdue.documentIds], ["item-geotech"]);
  // And not the type, which twenty lines share. Reddening CHECKLIST_ITEM would
  // redden the whole list over one late report.
  assert.equal(
    overdue.types.has(ComplianceDocumentType.CHECKLIST_ITEM),
    false,
  );
});

test("a consultant engaged before the deliverables table falls back to the column", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [
        outreach(CompliancePartyType.BASIX_CONSULTANT, {
          checklistDocumentId: "item-basix",
        }),
      ] as never,
      documents: [
        document(ComplianceDocumentType.CHECKLIST_ITEM, { id: "item-basix" }),
      ] as never,
      alerts: [alert(ComplianceAlertType.BASIX_RESPONSE_OVERDUE)] as never,
    }),
  );

  assert.deepEqual([...overdue.documentIds], ["item-basix"]);
});

test("a checklist line that has since been re-extracted away marks nothing", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      outreaches: [
        outreach(CompliancePartyType.BASIX_CONSULTANT, {
          checklistDocumentId: "item-that-is-gone",
        }),
      ] as never,
      alerts: [alert(ComplianceAlertType.BASIX_RESPONSE_OVERDUE)] as never,
    }),
  );

  assert.equal(overdue.documentIds.size, 0);
});

// ---------------------------------------------------------------------------
// The portals, which have no party at all
// ---------------------------------------------------------------------------

test("a delayed portal application marks the document it is waiting on", () => {
  const overdue = overdueComplianceDocuments(
    engagement({
      alerts: [
        alert(ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED),
        alert(ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED),
      ] as never,
    }),
  );

  assert.ok(
    overdue.types.has(ComplianceDocumentType.PLANNING_CERTIFICATE_10_7),
  );
  assert.ok(overdue.types.has(ComplianceDocumentType.LONG_SERVICE_LEVY));
});

test("both developer alerts point at the bushfire report", () => {
  for (const type of [
    ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
  ]) {
    const overdue = overdueComplianceDocuments(
      engagement({ alerts: [alert(type)] as never }),
    );

    assert.ok(
      overdue.types.has(ComplianceDocumentType.BUSHFIRE_REPORT),
      `${type} did not mark the bushfire report`,
    );
  }
});

// ---------------------------------------------------------------------------
// How the sections ask
// ---------------------------------------------------------------------------

test("a checklist row is only ever late by id", () => {
  const overdue = {
    types: new Set([ComplianceDocumentType.CHECKLIST_ITEM]),
    documentIds: new Set(["item-1"]),
  };

  assert.equal(
    isDocumentOverdue(
      overdue,
      document(ComplianceDocumentType.CHECKLIST_ITEM, {
        id: "item-1",
      }) as never,
      ComplianceDocumentType.CHECKLIST_ITEM,
    ),
    true,
  );
  assert.equal(
    isDocumentOverdue(
      overdue,
      document(ComplianceDocumentType.CHECKLIST_ITEM, {
        id: "item-2",
      }) as never,
      ComplianceDocumentType.CHECKLIST_ITEM,
    ),
    false,
  );
});

test("a pack row with no document row yet is still late", () => {
  // The common case, and the one a naive id-only check misses: nobody has
  // uploaded anything, so there is no row to carry the badge.
  const overdue = {
    types: new Set([ComplianceDocumentType.SURVEY]),
    documentIds: new Set<string>(),
  };

  assert.equal(
    isDocumentOverdue(overdue, undefined, ComplianceDocumentType.SURVEY),
    true,
  );
});
