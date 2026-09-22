import assert from "node:assert/strict";
import { ComplianceDocumentStatus } from "@prisma/client";
import { test } from "vitest";

import {
  isNotRequired,
  isOutstandingEvidence,
  MAPPABLE_DOCUMENT_TYPES,
} from "@/constants/complianceDocuments";

const row = (status: ComplianceDocumentStatus, fileCount = 0) => ({
  status,
  files: Array.from({ length: fileCount }, (_, index) => index),
});

test("only NOT_REQUIRED counts as waved off", () => {
  assert.equal(isNotRequired(ComplianceDocumentStatus.NOT_REQUIRED), true);
  for (const status of [
    ComplianceDocumentStatus.PENDING,
    ComplianceDocumentStatus.UPLOADED,
    ComplianceDocumentStatus.RECEIVED,
    ComplianceDocumentStatus.APPROVED,
    ComplianceDocumentStatus.REJECTED,
  ]) {
    assert.equal(isNotRequired(status), false, status);
  }
});

// The predicate behind both halves of the review send — the button on the tab
// and the throw on the server. If those two ever disagree the engagement is
// stranded: the tab offers a send the server refuses.
test("a row is outstanding when nothing is supplied and nobody waved it off", () => {
  assert.equal(
    isOutstandingEvidence(row(ComplianceDocumentStatus.PENDING)),
    true,
  );
  assert.equal(
    isOutstandingEvidence(row(ComplianceDocumentStatus.PENDING, 1)),
    false,
  );
  assert.equal(
    isOutstandingEvidence(row(ComplianceDocumentStatus.UPLOADED, 1)),
    false,
  );
});

test("a waved-off row is never outstanding, with or without a file", () => {
  // With a file matters: a line can be marked not required after something was
  // uploaded against it, and the file stays so that putting the row back
  // restores the evidence with it.
  assert.equal(
    isOutstandingEvidence(row(ComplianceDocumentStatus.NOT_REQUIRED)),
    false,
  );
  assert.equal(
    isOutstandingEvidence(row(ComplianceDocumentStatus.NOT_REQUIRED, 1)),
    false,
  );
});

// A rejection sends the row back to PENDING with its old file still attached,
// so the file count alone would call it settled. It is not: it is the one row
// somebody has to act on today.
test("a rejected row that still holds the refused file is outstanding", () => {
  assert.equal(
    isOutstandingEvidence(row(ComplianceDocumentStatus.REJECTED)),
    true,
  );
});

test("a checklist line can ask for anything except a checklist line", () => {
  assert.ok(MAPPABLE_DOCUMENT_TYPES.includes("SURVEY"));
  // The signed copies are excluded from the inbound classifier on purpose but
  // belong here: "complete the attached form and return it signed" is one of
  // the commonest lines on a certifier's checklist.
  assert.ok(MAPPABLE_DOCUMENT_TYPES.includes("SIGNED_FEE_PROPOSAL"));
  assert.ok(MAPPABLE_DOCUMENT_TYPES.includes("SIGNED_CDC_FORM"));
  assert.ok(MAPPABLE_DOCUMENT_TYPES.includes("HOME_INSURANCE"));
  assert.ok(!MAPPABLE_DOCUMENT_TYPES.includes("CHECKLIST_ITEM"));
  assert.ok(!MAPPABLE_DOCUMENT_TYPES.includes("UNKNOWN"));
});
