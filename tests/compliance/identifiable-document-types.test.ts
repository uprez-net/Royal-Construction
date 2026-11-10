import assert from "node:assert/strict";
import { ComplianceDocumentType } from "@prisma/client";
import { test } from "vitest";

import {
  complianceDocumentLabel,
  IDENTIFIABLE_DOCUMENT_GROUPS,
  IDENTIFIABLE_DOCUMENT_TYPES,
} from "@/constants/complianceDocuments";

test("every identifiable type is offered exactly once in the picker", () => {
  const grouped = IDENTIFIABLE_DOCUMENT_GROUPS.flatMap((group) => group.types);
  assert.equal(new Set(grouped).size, grouped.length);
  assert.deepEqual(
    [...grouped].sort(),
    [...IDENTIFIABLE_DOCUMENT_TYPES].sort(),
  );
});

test("the picker never offers 'we could not tell' or a signed copy", () => {
  for (const type of [
    ComplianceDocumentType.UNKNOWN,
    ComplianceDocumentType.SIGNED_CDC_FORM,
    ComplianceDocumentType.SIGNED_FEE_PROPOSAL,
    ComplianceDocumentType.CHECKLIST_ITEM,
  ]) {
    assert.equal(IDENTIFIABLE_DOCUMENT_TYPES.includes(type), false, type);
  }
});

test("it offers far more than the certifier's four, each with a real label", () => {
  assert.ok(IDENTIFIABLE_DOCUMENT_TYPES.length > 20);
  for (const type of IDENTIFIABLE_DOCUMENT_TYPES) {
    assert.notEqual(complianceDocumentLabel(type), type, type);
  }
});
