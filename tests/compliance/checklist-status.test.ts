import assert from "node:assert/strict";

import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";
import { test } from "vitest";

import {
  CHECKLIST_ISSUED_FROM,
  setComplianceDocumentNotRequired,
} from "@/lib/domain/compliance/documents";
import { applyAssessorCorrespondence } from "@/lib/domain/compliance/issued-items";
import { DomainTransitionError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

/**
 * The two ways a certifier engagement got stuck short of APPROVED with every
 * checklist line settled, which locked the certificate block for good:
 *
 *  1. The certifier listed what they wanted in the body of a reply. The rows
 *     were created but the status stayed at RESPONSE_RECEIVED, and the close
 *     only starts from the tracking statuses.
 *  2. The last open line was marked not required rather than approved, and
 *     only an approval ever checked whether the checklist was done.
 */

type EngagementUpdate = {
  where: { status: { in: CertifierEngagementStatus[] } };
  data: { status: CertifierEngagementStatus };
};

const engagementUpdates = (recorder: ReturnType<typeof recordingDb>) =>
  recorder
    .writes()
    .filter((call) => call.operation === "certifierEngagement.updateMany")
    .map((call) => call.args as EngagementUpdate);

const checklistLine = (overrides: Record<string, unknown> = {}) => ({
  _count: { files: 0 },
  documentType: ComplianceDocumentType.CHECKLIST_ITEM,
  engagementId: "eng_1",
  id: "doc_1",
  label: "Survey",
  status: ComplianceDocumentStatus.PENDING,
  ...overrides,
});

test("waving off the last open checklist line closes the engagement", async () => {
  const recorder = recordingDb({
    "complianceDocument.findFirst": checklistLine(),
    "complianceDocument.count": 0,
  });

  const result = await setComplianceDocumentNotRequired(
    adminPrincipal(),
    { documentId: "doc_1", notRequired: true, projectId: "p_1" },
    recorder.db,
  );

  assert.equal(result.engagementClosed, true);
  const [update] = engagementUpdates(recorder);
  assert.equal(update.data.status, CertifierEngagementStatus.APPROVED);
  assert.deepEqual(update.where.status.in, [
    CertifierEngagementStatus.IN_REVIEW,
    CertifierEngagementStatus.CHECKLIST_TRACKING,
    CertifierEngagementStatus.INSURANCE,
  ]);
});

test("waving off a line while others are open leaves the engagement alone", async () => {
  const recorder = recordingDb({
    "complianceDocument.findFirst": checklistLine(),
    "complianceDocument.count": 2,
  });

  const result = await setComplianceDocumentNotRequired(
    adminPrincipal(),
    { documentId: "doc_1", notRequired: true, projectId: "p_1" },
    recorder.db,
  );

  assert.equal(result.engagementClosed, false);
  assert.deepEqual(engagementUpdates(recorder), []);
});

test("a DA line or a restored line never closes the certifier's engagement", async () => {
  // DA rows are the council's, not part of the certifier's review.
  const da = recordingDb({
    "complianceDocument.findFirst": checklistLine({
      documentType: ComplianceDocumentType.DA_ITEM,
    }),
  });
  const daResult = await setComplianceDocumentNotRequired(
    adminPrincipal(),
    { documentId: "doc_1", notRequired: true, projectId: "p_1" },
    da.db,
  );
  assert.equal(daResult.engagementClosed, false);
  assert.deepEqual(engagementUpdates(da), []);

  // Putting a line back opens work, it does not settle it.
  const restored = recordingDb({
    "complianceDocument.findFirst": checklistLine({
      status: ComplianceDocumentStatus.NOT_REQUIRED,
    }),
    "certifierEngagement.findUnique": {
      status: CertifierEngagementStatus.CHECKLIST_TRACKING,
    },
  });
  const restoredResult = await setComplianceDocumentNotRequired(
    adminPrincipal(),
    { documentId: "doc_1", notRequired: false, projectId: "p_1" },
    restored.db,
  );
  assert.equal(restoredResult.engagementClosed, false);
  assert.deepEqual(engagementUpdates(restored), []);
});

/**
 * A database that remembers one checklist line and its engagement, so a waiver
 * and the restore after it can be run against the same state.
 */
function statefulChecklist(engagement: CertifierEngagementStatus) {
  const state = {
    document: ComplianceDocumentStatus.PENDING as ComplianceDocumentStatus,
    engagement,
  };
  const recorder = recordingDb({
    "complianceDocument.findFirst": () =>
      checklistLine({ status: state.document }),
    "complianceDocument.updateMany": (args: unknown) => {
      const { data, where } = args as {
        data: { status: ComplianceDocumentStatus };
        where: { status: ComplianceDocumentStatus };
      };
      if (where.status !== state.document) return { count: 0 };
      state.document = data.status;
      return { count: 1 };
    },
    // The only line on the checklist.
    "complianceDocument.count": () =>
      state.document === ComplianceDocumentStatus.APPROVED
      || state.document === ComplianceDocumentStatus.NOT_REQUIRED
        ? 0
        : 1,
    "certifierEngagement.findUnique": () => ({ status: state.engagement }),
    "certifierEngagement.updateMany": (args: unknown) => {
      const { data, where } = args as EngagementUpdate;
      if (!where.status.in.includes(state.engagement)) return { count: 0 };
      state.engagement = data.status;
      return { count: 1 };
    },
  });
  return { recorder, state };
}

const setRequired = (
  recorder: ReturnType<typeof recordingDb>,
  notRequired: boolean,
) =>
  setComplianceDocumentNotRequired(
    adminPrincipal(),
    { documentId: "doc_1", notRequired, projectId: "p_1" },
    recorder.db,
  );

test("putting back the line whose waiver closed the checklist reopens it", async () => {
  const { recorder, state } = statefulChecklist(
    CertifierEngagementStatus.CHECKLIST_TRACKING,
  );

  const waived = await setRequired(recorder, true);
  assert.equal(waived.engagementClosed, true);
  assert.equal(state.engagement, CertifierEngagementStatus.APPROVED);

  const restored = await setRequired(recorder, false);
  assert.equal(restored.engagementReopened, true);
  assert.equal(state.document, ComplianceDocumentStatus.PENDING);
  // Back to tracking, not left APPROVED with a line open on it.
  assert.equal(state.engagement, CertifierEngagementStatus.CHECKLIST_TRACKING);

  // And the ordinary close still works from there.
  const waivedAgain = await setRequired(recorder, true);
  assert.equal(waivedAgain.engagementClosed, true);
  assert.equal(state.engagement, CertifierEngagementStatus.APPROVED);
});

test("a line cannot be put back once the certificate has been issued", async () => {
  const { recorder, state } = statefulChecklist(
    CertifierEngagementStatus.CHECKLIST_TRACKING,
  );
  await setRequired(recorder, true);
  state.engagement = CertifierEngagementStatus.CERTIFICATE_ISSUED;

  await assert.rejects(setRequired(recorder, false), DomainTransitionError);
  assert.equal(state.engagement, CertifierEngagementStatus.CERTIFICATE_ISSUED);
});

test("the waiver and the close run in one transaction", async () => {
  const recorder = recordingDb({
    "complianceDocument.findFirst": checklistLine(),
    "complianceDocument.count": 0,
  });
  let transactions = 0;
  // A real client: `"$transaction" in db` is how the command tells one from a
  // caller's transaction, and the recorder answers false to it.
  const db = new Proxy(recorder.db, {
    has(target, property) {
      return property === "$transaction" || Reflect.has(target, property);
    },
    get(target, property, receiver) {
      if (property === "$transaction") {
        const open = Reflect.get(target, property, receiver) as (
          run: (tx: unknown) => Promise<unknown>,
        ) => Promise<unknown>;
        return (run: (tx: unknown) => Promise<unknown>) => {
          transactions += 1;
          return open(run);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  await setComplianceDocumentNotRequired(
    adminPrincipal(),
    { documentId: "doc_1", notRequired: true, projectId: "p_1" },
    db,
  );

  assert.equal(transactions, 1);
});

const projectWithEngagement = {
  Lead: null,
  certifierEngagement: {
    id: "eng_1",
    status: CertifierEngagementStatus.RESPONSE_RECEIVED,
  },
  customerId: null,
  id: "p_1",
  location: null,
  siteManagerId: null,
};

test("items a certifier lists in an email start the checklist being tracked", async () => {
  const recorder = recordingDb({
    "project.findUnique": projectWithEngagement,
    "complianceDocument.findMany": [],
  });

  const outcome = await applyAssessorCorrespondence(
    systemPrincipal("test"),
    {
      assessor: "certifier",
      engagementId: "eng_1",
      projectId: "p_1",
      rejected: [],
      requested: [{ description: "", label: "Site classification report" }],
    },
    recorder.transactionalDb,
  );

  assert.equal(outcome.created, 1);
  const [update] = engagementUpdates(recorder);
  assert.equal(
    update.data.status,
    CertifierEngagementStatus.CHECKLIST_TRACKING,
  );
  // The status the stuck job was in, and the two a first reply arrives in.
  assert.deepEqual(update.where.status.in, [...CHECKLIST_ISSUED_FROM]);
  assert.ok(
    update.where.status.in.includes(
      CertifierEngagementStatus.RESPONSE_RECEIVED,
    ),
  );
  assert.ok(
    update.where.status.in.includes(
      CertifierEngagementStatus.AWAITING_RESPONSE,
    ),
  );
});

test("a council's requests and a certifier's rejections alone move nothing", async () => {
  const council = recordingDb({
    "project.findUnique": projectWithEngagement,
    "complianceDocument.findMany": [],
  });
  await applyAssessorCorrespondence(
    systemPrincipal("test"),
    {
      assessor: "council",
      engagementId: "eng_1",
      projectId: "p_1",
      rejected: [],
      requested: [{ description: "", label: "Traffic plan" }],
    },
    council.transactionalDb,
  );
  assert.deepEqual(engagementUpdates(council), []);

  const rejectionOnly = recordingDb({
    "project.findUnique": projectWithEngagement,
    "complianceDocument.findMany": [],
  });
  await applyAssessorCorrespondence(
    systemPrincipal("test"),
    {
      assessor: "certifier",
      engagementId: "eng_1",
      projectId: "p_1",
      rejected: [{ documentName: "Survey", reason: "Out of date" }],
      requested: [],
    },
    rejectionOnly.transactionalDb,
  );
  assert.deepEqual(engagementUpdates(rejectionOnly), []);
});
