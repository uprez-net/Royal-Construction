import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CertifierEmailDirection,
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";
import { test } from "vitest";

import {
  canSelectForEarlyReview,
  earlyReviewSelection,
} from "@/lib/domain/compliance/early-review";
import {
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import type {
  CertifierEngagementDetail,
  ComplianceDocumentWithFiles,
} from "@/types/compliance";
import { REPO_ROOT } from "../support/repo-root";

// A partly complete checklist pack, in one email. The office ticks the rows it
// has and sends them together; which rows can be ticked is the same rule the
// send applies, so a checkbox never offers a row the server would refuse.

function item(
  id: string,
  order: number,
  overrides: Partial<{
    url: string | null;
    status: ComplianceDocumentStatus;
    rejectionReason: string | null;
    documentType: ComplianceDocumentType;
  }> = {},
): ComplianceDocumentWithFiles {
  const url =
    overrides.url === undefined ? `https://blob.test/${id}.pdf` : overrides.url;
  return {
    id,
    order,
    label: `Item ${id}`,
    documentType:
      overrides.documentType ?? ComplianceDocumentType.CHECKLIST_ITEM,
    status: overrides.status ?? ComplianceDocumentStatus.UPLOADED,
    rejectionReason: overrides.rejectionReason ?? null,
    files: url
      ? [
          {
            id: `file-${id}`,
            url,
            filename: `${id}.pdf`,
            fileType: "application/pdf",
          },
        ]
      : [],
  } as unknown as ComplianceDocumentWithFiles;
}

function engagement(
  documents: ComplianceDocumentWithFiles[],
  options: { sentUrls?: string[]; daBlocked?: boolean } = {},
): CertifierEngagementDetail {
  return {
    alerts: options.daBlocked
      ? [
          {
            type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
            status: ComplianceAlertStatus.OPEN,
          },
        ]
      : [],
    documents,
    emails: (options.sentUrls ?? []).map((url) => ({
      direction: CertifierEmailDirection.OUTBOUND,
      attachments: [{ name: "sent.pdf", url }],
    })),
  } as unknown as CertifierEngagementDetail;
}

test("only uploaded, unsent, unsettled checklist rows can be ticked", () => {
  const rows = [
    item("ready", 1),
    item("empty", 2, { url: null }),
    item("sent", 3),
    item("rejected", 4, { rejectionReason: "Wrong revision" }),
    item("approved", 5, { status: ComplianceDocumentStatus.APPROVED }),
    item("waived", 6, { status: ComplianceDocumentStatus.NOT_REQUIRED }),
    item("pack", 7, { documentType: ComplianceDocumentType.CHECKLIST }),
  ];
  const file = engagement(rows, { sentUrls: ["https://blob.test/sent.pdf"] });

  assert.deepEqual(
    rows
      .filter((row) => canSelectForEarlyReview(file, row))
      .map((row) => row.id),
    ["ready"],
  );
});

test("nothing can be ticked while the job waits on development approval", () => {
  const rows = [item("ready", 1)];
  assert.equal(
    canSelectForEarlyReview(engagement(rows, { daBlocked: true }), rows[0]),
    false,
  );
});

test("a send carries the ticked rows in checklist order and leaves off what the certifier has", () => {
  const rows = [item("c", 3), item("a", 1), item("b", 2)];
  const file = engagement(rows, { sentUrls: ["https://blob.test/b.pdf"] });

  const { toSend, alreadySent } = earlyReviewSelection(file, ["c", "b", "a"]);
  assert.deepEqual(
    toSend.map((row) => row.id),
    ["a", "c"],
  );
  assert.deepEqual(
    alreadySent.map((row) => row.id),
    ["b"],
  );
});

test("one row that cannot go refuses the whole send, naming it", () => {
  const rows = [item("a", 1), item("b", 2, { rejectionReason: "Redo" })];
  assert.throws(
    () => earlyReviewSelection(engagement(rows), ["a", "b"]),
    (error: unknown) =>
      error instanceof DomainTransitionError && /Item b/.test(error.message),
  );
});

test("an empty selection, or an id from another file, is refused", () => {
  const rows = [item("a", 1)];
  assert.throws(
    () => earlyReviewSelection(engagement(rows), []),
    DomainValidationError,
  );
  assert.throws(
    () => earlyReviewSelection(engagement(rows), ["a", "elsewhere"]),
    DomainValidationError,
  );
});

test("the tab offers checkboxes from the shared rule and sends them together", () => {
  const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
  const tab = read(
    "components/projects/detail/compliance-tab/project-compliance-tab.tsx",
  );
  assert.match(tab, /canSelectForEarlyReview\(engagement, item\)/);
  assert.match(tab, /sendComplianceDocumentsForReview\(/);
  // The one-document-per-email button is gone from the row.
  const row = read(
    "components/projects/detail/compliance-tab/compliance-document-row.tsx",
  );
  assert.doesNotMatch(row, /onSendForReview/);

  const send = read("lib/data/compliance.ts");
  assert.match(send, /earlyReviewSelection\(engagement, documentIds\)/);
});
