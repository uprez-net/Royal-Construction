import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
} from "@prisma/client";

import {
  CHECKLIST_MAPPABLE_TYPES,
  EXTERNAL_APPLICATION_DOCUMENT_TYPE,
  isChecklistMappableType,
} from "../../constants/complianceDocuments";
import {
  checklistBlockedReason,
  hasDevelopmentApplication,
  hasDevelopmentConsent,
  requiresPlanningCertificate,
  type CertifierEngagementDetail,
} from "../../types/compliance";

/**
 * The development approval path, and what it does to the checklist.
 *
 * The two halves of a compliance file used to be exclusive: a job was a CDC or
 * it was a DA, and the tab rendered one list or the other. It is both. A
 * certifier says the proposal needs development approval *on the checklist they
 * have just issued*, so the checklist exists, its twenty rows are real, and most
 * of what the council wants is on it — but nothing on it can be assessed until
 * the consent arrives.
 *
 * So the rule these tests pin is: the DA and the checklist run side by side, the
 * checklist is frozen while the DA is outstanding, and the consent document —
 * not a ticked box — is what reopens it.
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

const daAlert = [
  {
    id: "alert-da",
    type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
    status: ComplianceAlertStatus.OPEN,
  },
];

const resolvedDaAlert = [
  {
    id: "alert-da",
    type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
    status: ComplianceAlertStatus.RESOLVED,
  },
];

const consentDocument = {
  id: "document-consent",
  documentType: ComplianceDocumentType.DEVELOPMENT_CONSENT,
  status: ComplianceDocumentStatus.UPLOADED,
  files: [{ id: "file-1", url: "https://blob/consent.pdf" }],
};

// ---------------------------------------------------------------------------
// The freeze
// ---------------------------------------------------------------------------

test("an open DA condition freezes the checklist", () => {
  const blocked = checklistBlockedReason(
    engagement({ alerts: daAlert as never }),
  );

  assert.ok(blocked);
  // The sentence is read by the card and thrown by the review send, so it has
  // to say what to do rather than only what is wrong.
  assert.match(blocked, /development approval/i);
});

test("a file with no DA condition is not frozen", () => {
  assert.equal(checklistBlockedReason(engagement()), null);
});

test("the consent document reopens the checklist", () => {
  // The case the whole arrangement is for: the council has approved it, the
  // notice is on the file, and the builder goes back to collecting for the
  // certifier. Tested with the alert still open because the resolve happens in
  // an after() behind the upload — the checklist must reopen on the document
  // rather than on the bookkeeping that follows it.
  const file = engagement({
    alerts: daAlert as never,
    documents: [consentDocument] as never,
  });

  assert.equal(hasDevelopmentConsent(file), true);
  assert.equal(checklistBlockedReason(file), null);
});

test("a consent row with no file on it does not reopen the checklist", () => {
  // Somebody ticking the application as received is reporting it; the notice of
  // determination on the row is proving it. A certifier asked to resume
  // assessing on the strength of a tick has nothing to read.
  const file = engagement({
    alerts: daAlert as never,
    documents: [{ ...consentDocument, files: [] }] as never,
  });

  assert.equal(hasDevelopmentConsent(file), false);
  assert.ok(checklistBlockedReason(file));
});

// ---------------------------------------------------------------------------
// What survives the consent
// ---------------------------------------------------------------------------

test("the DA block outlives the condition that raised it", () => {
  // Once the consent lands the alert resolves, and if the block keyed on that
  // alert the whole development application — its lodgement date, its DA
  // number, the documents it took — would vanish from the tab at the moment it
  // succeeded. It keys on the application row instead.
  const file = engagement({
    alerts: resolvedDaAlert as never,
    externalApplications: [
      {
        id: "application-1",
        kind: ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
        alreadyHeld: false,
        appliedAt: new Date("2026-06-01"),
        applicationRef: "DA-2026-123",
        receivedAt: new Date("2026-08-01"),
      },
    ] as never,
  });

  assert.equal(hasDevelopmentApplication(file), true);
  // And the 10.7 goes back to being the certifier pack's, because the DA block
  // is no longer the place it is ordered from.
  assert.equal(requiresPlanningCertificate(file), true);
});

test("a raised condition shows the DA block before anything is lodged", () => {
  // The row is only written when somebody records a step, so between the alert
  // and the first click there is nothing but the alert to go on.
  assert.equal(
    hasDevelopmentApplication(engagement({ alerts: daAlert as never })),
    true,
  );
  assert.equal(hasDevelopmentApplication(engagement()), false);
});

// ---------------------------------------------------------------------------
// Sharing documents with the checklist
// ---------------------------------------------------------------------------

test("the development application produces a document, not just a date", () => {
  // It was null here for one release, on the reasoning that a DA comes back as
  // a consent for the whole job rather than a row on a list. True, and beside
  // the point: the consent is a PDF somebody holds, the certifier asks for it
  // by name, and the checklist cannot reopen without it.
  assert.equal(
    EXTERNAL_APPLICATION_DOCUMENT_TYPE[
      ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION
    ],
    ComplianceDocumentType.DEVELOPMENT_CONSENT,
  );
});

test("everything the DA and the checklist share can be mapped between them", () => {
  // A DA is assessed on very nearly the same evidence as a CDC, so a document
  // supplied on one list is the document the other asked for. Each of these
  // appears on the DA list and can be named by a checklist line.
  for (const type of [
    ComplianceDocumentType.BASIX_CERTIFICATE,
    ComplianceDocumentType.BUSHFIRE_REPORT,
    ComplianceDocumentType.STRUCTURAL_DRAWINGS,
    ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS,
    ComplianceDocumentType.GEOTECH_REPORT,
    ComplianceDocumentType.WATER_SERVICING_APPROVAL,
    ComplianceDocumentType.SECTION_73_NOTICE,
    ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
    ComplianceDocumentType.TRAFFIC_CONTROL_PLAN,
    ComplianceDocumentType.ROAD_OPENING_PERMIT,
    ComplianceDocumentType.LONG_SERVICE_LEVY,
    ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL,
    ComplianceDocumentType.DEVELOPMENT_CONSENT,
  ]) {
    assert.ok(
      isChecklistMappableType(type),
      `${type} is on the DA list but cannot fill the checklist line asking for it`,
    );
  }
});

test("the exclusions from mapping survive the set being widened", () => {
  // The set became "everything except" when the DA list arrived, and these are
  // the cases that argument has to keep getting right. A superseded plan set
  // answering a line about the current one looks answered and is not; handing a
  // certifier their own fee proposal back is not evidence of anything.
  for (const type of [
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    ComplianceDocumentType.INVOICE,
    ComplianceDocumentType.FEE_PROPOSAL,
    ComplianceDocumentType.CDC_FORM,
    ComplianceDocumentType.CHECKLIST,
    ComplianceDocumentType.CHECKLIST_ITEM,
    ComplianceDocumentType.UNKNOWN,
  ]) {
    assert.equal(
      CHECKLIST_MAPPABLE_TYPES.has(type),
      false,
      `${type} must not be copied onto a checklist line`,
    );
  }
});
