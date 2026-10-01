import assert from "node:assert/strict";
import {
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  CompliancePartyType,
  OutboxEventStatus,
} from "@prisma/client";
import { test } from "vitest";

import {
  prepareComplianceOutreach,
  sendComplianceOutreach,
  type SendComplianceOutreachInput,
} from "@/lib/domain/compliance/outreach";
import {
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { adminPrincipal, recordingDb } from "./domain-harness";

// #366 7c: a consultant could be engaged on any project, and an opening
// outreach went to whatever address it was handed. The compliance tab only
// ever offered a checklist row's consultant, picked from that party's trade in
// the tradie directory; the domain now holds both rules, for the tab and Eve.

const projectId = "project_1";

function checklistLine(
  id: string,
  detail: Record<string, unknown> | null,
  status: ComplianceDocumentStatus = ComplianceDocumentStatus.PENDING,
) {
  return {
    detail,
    documentType: ComplianceDocumentType.CHECKLIST_ITEM,
    files: [],
    id,
    status,
  };
}

const basixLine = checklistLine("line_basix", {
  description: "BASIX certificate",
  mapsToType: ComplianceDocumentType.BASIX_CERTIFICATE,
});

const basixAssessor = {
  additionalEmails: ["office@basix.example"],
  email: "assess@basix.example",
  id: "tradie_basix",
  name: "Basix Assessors Pty Ltd",
  phone: "0400000000",
  trade: "BASIX Assessment",
};

function script(
  documents: readonly unknown[],
  tradie: unknown = basixAssessor,
  sent: unknown[] = [],
) {
  return {
    "certifierEngagement.findUnique": {
      alerts: [],
      documents,
      emails: [],
      id: "engagement_1",
      outreaches: [],
      subjectAddress: "Lot 9028 Sommerville Drive, Catherine Field NSW 2557",
    },
    "complianceOutreach.create": (args: unknown) => {
      const data = (args as { data: Record<string, unknown> }).data;
      sent.push(data);
      return { id: "outreach_1", ...data };
    },
    "outboxEvent.findUnique": (args: unknown) => ({
      attempts: 0,
      id: "effect_1",
      key: (args as { where: { key: string } }).where.key,
      kind: "COMPLIANCE_EMAIL_SEND",
      payload: {},
      status: OutboxEventStatus.PENDING,
    }),
    "outboxEvent.upsert": (args: unknown) => ({
      id: "effect_1",
      key: (args as { where: { key: string } }).where.key,
      result: null,
      status: OutboxEventStatus.PENDING,
    }),
    "outboxEvent.updateMany": { count: 1 },
    "project.findUnique": {
      certifierEngagement: { id: "engagement_1", status: "OUTREACH_SENT" },
      customerId: "customer_1",
      id: projectId,
      Lead: null,
      location: "Catherine Field NSW 2557",
      siteManagerId: null,
    },
    "tradie.findUnique": tradie,
    "tradie.findMany": [basixAssessor],
  };
}

function basixSend(
  overrides: Partial<SendComplianceOutreachInput> = {},
): SendComplianceOutreachInput {
  return {
    body: "<p>Could you assess this lot?</p>",
    deliverables: [],
    extraAttachmentIds: [],
    party: CompliancePartyType.BASIX_CONSULTANT,
    projectId,
    tradieId: basixAssessor.id,
    ...overrides,
  };
}

const neverSend = async () => {
  throw new Error("nothing should have been sent");
};

test("a consultant no checklist line asks for is not engaged", async () => {
  // Staging: a BASIX outreach went out on a project whose checklist never
  // asked for a BASIX certificate.
  const recorder = recordingDb(script([]));

  await assert.rejects(
    sendComplianceOutreach(
      adminPrincipal(),
      basixSend(),
      recorder.transactionalDb,
      neverSend,
    ),
    (error) =>
      error instanceof DomainTransitionError
      && /Nothing on this project's certifier checklist asks for the basix consultant/.test(
        error.message,
      ),
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a checklist line marked not required does not count", async () => {
  const recorder = recordingDb(
    script([
      checklistLine(
        "line_basix",
        { mapsToType: ComplianceDocumentType.BASIX_CERTIFICATE },
        ComplianceDocumentStatus.NOT_REQUIRED,
      ),
    ]),
  );

  await assert.rejects(
    sendComplianceOutreach(
      adminPrincipal(),
      basixSend(),
      recorder.transactionalDb,
      neverSend,
    ),
    DomainTransitionError,
  );
});

test("a consultant asked for goes to their own directory address", async () => {
  const created: unknown[] = [];
  const delivered: string[] = [];
  const recorder = recordingDb(script([basixLine], basixAssessor, created));

  const result = await sendComplianceOutreach(
    adminPrincipal(),
    basixSend(),
    recorder.transactionalDb,
    async ({ outreach }) => {
      delivered.push(outreach.contactEmail ?? "");
    },
  );

  assert.equal(result.recipient, "assess@basix.example");
  assert.deepEqual(delivered, ["assess@basix.example"]);
  assert.equal((created[0] as { tradieId: string }).tradieId, basixAssessor.id);
  assert.equal(
    (created[0] as { contactName: string }).contactName,
    basixAssessor.name,
  );
});

test("an unlabelled line the outreach is engaged off still counts", async () => {
  // The tab's "pressed on this row" case: the extraction could not say what
  // the line asks for, and somebody engaged the consultant from it anyway.
  const recorder = recordingDb(
    script([checklistLine("line_unlabelled", { description: "Item 7" })]),
  );

  const result = await sendComplianceOutreach(
    adminPrincipal(),
    basixSend({ checklistDocumentId: "line_unlabelled" }),
    recorder.transactionalDb,
    async () => undefined,
  );

  assert.equal(result.recipient, "assess@basix.example");
});

test("an outreach needs a tradie from that party's list", async () => {
  const recorder = recordingDb(script([basixLine]));

  await assert.rejects(
    sendComplianceOutreach(
      adminPrincipal(),
      basixSend({
        contactEmail: "nabeel.wasif@uprez.net",
        tradieId: undefined,
      }),
      recorder.transactionalDb,
      neverSend,
    ),
    (error) =>
      error instanceof DomainValidationError && error.field === "tradieId",
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a tradie on another trade's list is refused", async () => {
  const recorder = recordingDb(
    script([basixLine], {
      ...basixAssessor,
      id: "tradie_survey",
      name: "Land Surveying Services Pty Ltd",
      trade: "Surveying",
    }),
  );

  await assert.rejects(
    sendComplianceOutreach(
      adminPrincipal(),
      basixSend({ tradieId: "tradie_survey" }),
      recorder.transactionalDb,
      neverSend,
    ),
    /listed under Surveying, not BASIX Assessment/,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("an address that is not the tradie's own is refused", async () => {
  const recorder = recordingDb(script([basixLine]));

  await assert.rejects(
    sendComplianceOutreach(
      adminPrincipal(),
      basixSend({ contactEmail: "someone@elsewhere.example" }),
      recorder.transactionalDb,
      neverSend,
    ),
    (error) =>
      error instanceof DomainValidationError && error.field === "contactEmail",
  );
});

test("one of the tradie's additional addresses may be chosen", async () => {
  const recorder = recordingDb(script([basixLine]));

  const result = await sendComplianceOutreach(
    adminPrincipal(),
    basixSend({ contactEmail: "Office@Basix.example" }),
    recorder.transactionalDb,
    async () => undefined,
  );

  assert.equal(result.recipient, "office@basix.example");
});

test("nothing is sent to the council from here", async () => {
  const recorder = recordingDb(script([]));

  await assert.rejects(
    sendComplianceOutreach(
      adminPrincipal(),
      basixSend({ party: CompliancePartyType.COUNCIL }),
      recorder.transactionalDb,
      neverSend,
    ),
    DomainTransitionError,
  );
});

test("prepare says why a consultant is blocked and lists who may be engaged", async () => {
  const blocked = await prepareComplianceOutreach(
    adminPrincipal(),
    { party: CompliancePartyType.BASIX_CONSULTANT, projectId },
    recordingDb(script([])).db,
  );
  assert.equal(blocked.available, true);
  if (!blocked.available) return;
  assert.match(
    blocked.blocked ?? "",
    /Nothing on this project's certifier checklist/,
  );
  assert.equal(blocked.canSend, false);
  assert.deepEqual(
    blocked.candidates.map((candidate) => candidate.id),
    [basixAssessor.id],
  );

  const open = await prepareComplianceOutreach(
    adminPrincipal(),
    { party: CompliancePartyType.BASIX_CONSULTANT, projectId },
    recordingDb(script([basixLine])).db,
  );
  assert.equal(open.available && open.blocked, null);
});
