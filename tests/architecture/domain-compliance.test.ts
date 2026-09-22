import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  CertifierEmailDirection,
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";

import { resolveComplianceDocument } from "../../lib/domain/compliance/documents";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
} from "../../lib/domain/errors";
import { ROOT } from "./module-graph";
import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Phase 5 of issue #301: the certifier's decision on compliance evidence.

const read = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const CHECKLIST_DOC = {
  documentType: ComplianceDocumentType.CHECKLIST_ITEM,
  engagementId: "eng_1",
  files: [{ id: "f_1", url: "https://blob.example/waste.pdf" }],
  id: "doc_1",
  label: "Waste management plan",
  status: ComplianceDocumentStatus.UPLOADED,
};

// hasSentCurrentDocument reads the outbound mail trail rather than a status
// flag: the certifier has this copy only if every file URL on the row appears
// on an OUTBOUND email. A replacement changes the URL and the answer goes back
// to false until the replacement itself is sent.
const ENGAGEMENT_THAT_SENT_IT = {
  emails: [
    {
      attachments: [
        { name: "waste.pdf", url: "https://blob.example/waste.pdf" },
      ],
      direction: CertifierEmailDirection.OUTBOUND,
    },
  ],
  id: "eng_1",
  status: CertifierEngagementStatus.IN_REVIEW,
};

test("only an admin decides a compliance document", async () => {
  // The same gate resolving a tradie approval carries: this freezes a document
  // or sends it back, and must not be available to whoever uploaded it.
  const recorder = recordingDb({});
  await assert.rejects(
    () =>
      resolveComplianceDocument(
        siteManagerPrincipal(),
        {
          decision: "approved",
          documentId: "doc_1",
          projectId: "p_1",
        },
        recorder.db,
      ),
    DomainAuthorizationError,
  );
  // Refused before it read anything.
  assert.deepEqual(recorder.operations(), []);
});

test("a document that was never sent to the certifier cannot be decided", async () => {
  // Eve's copy had no equivalent check, so an agent could approve evidence
  // nobody had asked the certifier to look at — and the engagement would then
  // close on a review that never happened.
  const recorder = recordingDb({
    // An engagement that has sent nothing.
    "certifierEngagement.findUnique": {
      emails: [],
      id: "eng_1",
      packSentAt: null,
      status: CertifierEngagementStatus.IN_REVIEW,
    },
    "complianceDocument.findFirst": CHECKLIST_DOC,
  });

  await assert.rejects(
    () =>
      resolveComplianceDocument(
        adminPrincipal(),
        { decision: "approved", documentId: "doc_1", projectId: "p_1" },
        recorder.db,
      ),
    (error) => {
      assert.ok(error instanceof DomainTransitionError);
      assert.match(error.message, /has not been sent to the certifier yet/);
      return true;
    },
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a document that is not the certifier's to review is refused", async () => {
  const recorder = recordingDb({
    "complianceDocument.findFirst": {
      ...CHECKLIST_DOC,
      // A required-pack document is already the certifier's; nobody approves it.
      documentType: ComplianceDocumentType.SURVEY,
    },
  });

  await assert.rejects(
    () =>
      resolveComplianceDocument(
        adminPrincipal(),
        { decision: "approved", documentId: "doc_1", projectId: "p_1" },
        recorder.db,
      ),
    (error) => {
      assert.ok(error instanceof DomainTransitionError);
      assert.match(error.message, /not reviewed by the certifier/);
      return true;
    },
  );
});

test("a document on another project is not found", async () => {
  const recorder = recordingDb({ "complianceDocument.findFirst": null });
  await assert.rejects(
    () =>
      resolveComplianceDocument(
        adminPrincipal(),
        { decision: "approved", documentId: "doc_1", projectId: "p_1" },
        recorder.db,
      ),
    DomainNotFoundError,
  );
});

test("a second click resolves nothing rather than overwriting the first decision", async () => {
  const recorder = recordingDb({
    "certifierEngagement.findUnique": ENGAGEMENT_THAT_SENT_IT,
    "complianceDocument.findFirst": CHECKLIST_DOC,
    "complianceDocument.findUnique": {
      status: ComplianceDocumentStatus.APPROVED,
    },
    // The conditional claim matched nothing: someone already decided it.
    "complianceDocument.updateMany": { count: 0 },
  });

  const result = await resolveComplianceDocument(
    adminPrincipal(),
    { decision: "approved", documentId: "doc_1", projectId: "p_1" },
    recorder.db,
  );

  assert.equal(result.resolved, false);
  assert.equal(result.status, ComplianceDocumentStatus.APPROVED);
  // No engagement advance off the back of a decision that did not happen.
  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["complianceDocument.updateMany"],
  );
});

test("a rejection needs a reason, and returns the document to PENDING", async () => {
  const script = {
    "certifierEngagement.findUnique": ENGAGEMENT_THAT_SENT_IT,
    "complianceDocument.findFirst": CHECKLIST_DOC,
    "complianceDocument.updateMany": { count: 1 },
  };

  await assert.rejects(
    () =>
      resolveComplianceDocument(
        adminPrincipal(),
        { decision: "rejected", documentId: "doc_1", projectId: "p_1" },
        recordingDb(script).db,
      ),
    /A rejection reason is required/,
  );

  const recorder = recordingDb(script);
  const result = await resolveComplianceDocument(
    adminPrincipal(),
    {
      decision: "rejected",
      documentId: "doc_1",
      projectId: "p_1",
      rejectionReason: "  Wrong revision  ",
    },
    recorder.db,
  );

  assert.equal(result.resolved, true);
  // PENDING, not REJECTED: the UI reads status to choose between an upload
  // control and a decision pair, and the reason is what tells the admin why
  // they are uploading again.
  assert.equal(result.status, ComplianceDocumentStatus.PENDING);
  assert.deepEqual((recorder.writes()[0].args as { data: unknown }).data, {
    rejectionReason: "Wrong revision",
    status: ComplianceDocumentStatus.PENDING,
  });
});

test("the last approval closes the engagement, and says so exactly once", async () => {
  const recorder = recordingDb({
    "certifierEngagement.findUnique": ENGAGEMENT_THAT_SENT_IT,
    // This call won the conditional advance.
    "certifierEngagement.updateMany": { count: 1 },
    // Nothing left outstanding.
    "complianceDocument.count": 0,
    "complianceDocument.findFirst": CHECKLIST_DOC,
    "complianceDocument.updateMany": { count: 1 },
  });

  const result = await resolveComplianceDocument(
    adminPrincipal(),
    { decision: "approved", documentId: "doc_1", projectId: "p_1" },
    recorder.db,
  );

  assert.equal(result.resolved && result.engagementClosed, true);

  // Lost the race instead: another admin's approval closed it first.
  const loser = recordingDb({
    "certifierEngagement.findUnique": ENGAGEMENT_THAT_SENT_IT,
    "certifierEngagement.updateMany": { count: 0 },
    "complianceDocument.count": 0,
    "complianceDocument.findFirst": CHECKLIST_DOC,
    "complianceDocument.updateMany": { count: 1 },
  });
  const second = await resolveComplianceDocument(
    adminPrincipal(),
    { decision: "approved", documentId: "doc_1", projectId: "p_1" },
    loser.db,
  );
  // Both approvals landed; only one announces the engagement closed.
  assert.equal(second.resolved && second.engagementClosed, false);
});

test("an outstanding checklist item keeps the engagement open", async () => {
  const recorder = recordingDb({
    "certifierEngagement.findUnique": ENGAGEMENT_THAT_SENT_IT,
    "complianceDocument.count": 3,
    "complianceDocument.findFirst": CHECKLIST_DOC,
    "complianceDocument.updateMany": { count: 1 },
  });

  const result = await resolveComplianceDocument(
    adminPrincipal(),
    { decision: "approved", documentId: "doc_1", projectId: "p_1" },
    recorder.db,
  );

  assert.equal(result.resolved && result.engagementClosed, false);
  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["complianceDocument.updateMany"],
  );

  // NOT_REQUIRED counts as settled — a single waved-off line must not hold the
  // engagement open for good.
  const countArgs = recorder.calls.find(
    (call) => call.operation === "complianceDocument.count",
  )?.args as { where: { status: { notIn: string[] } } };
  assert.deepEqual(countArgs.where.status.notIn, [
    ComplianceDocumentStatus.APPROVED,
    ComplianceDocumentStatus.NOT_REQUIRED,
  ]);
});

test("the notification and audit side effects stayed in the adapters", () => {
  // `after` is a Next request concept — a cron or an Eve tool has no request
  // to defer into, which is why none of this could live in a shared module.
  const domain = read("lib/domain/compliance/documents.ts");
  assert.doesNotMatch(domain, /notifyCompliance/);
  assert.doesNotMatch(domain, /from "next\/server"/);
  assert.doesNotMatch(domain, /createActivityLogEntry/);

  const app = read("lib/data/compliance.ts");
  assert.match(app, /resolveComplianceDocumentDomain/);
  assert.match(app, /notifyCompliance\("complianceDocumentRejected"/);
});

test("Eve's compliance review calls the shared decision", () => {
  const source = read("agent/lib/project-operations.ts");
  assert.match(source, /resolveComplianceDocumentDomain/);
  // Its own copy of the status precondition is gone.
  assert.doesNotMatch(source, /isApprovableDocumentType/);
});
