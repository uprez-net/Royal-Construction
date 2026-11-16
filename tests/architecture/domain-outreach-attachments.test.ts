import assert from "node:assert/strict";
import {
  ComplianceDocumentType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
  OutboxEventStatus,
} from "@prisma/client";
import { test } from "vitest";

import { describeOutreachAttachments } from "@/lib/domain/agent/approval-targets";
import {
  outreachAttachments,
  prepareComplianceOutreach,
  previewOutreachAttachments,
  sendComplianceOutreach,
  type SendComplianceOutreachInput,
} from "@/lib/domain/compliance/outreach";
import { DomainTransitionError } from "@/lib/domain/errors";
import { adminPrincipal, recordingDb } from "./domain-harness";

// #366 item 2: the approval card showed the arguments the model wrote, and the
// send then added the party's standard pack on top, so an owner who asked for
// "no attachments" approved an email that went out with two PDFs. What the card
// shows, what Eve's prepare step lists and what is emailed must be one list.

const projectId = "project_1";

const file = (id: string, filename: string) => ({
  filename,
  fileType: "application/pdf",
  id,
  url: `https://store.example/${id}.pdf`,
});

// The BASIX pack is the plans, the survey and the 10.7 certificate. A land deed
// is on the file too but is not part of that party's pack.
const documents = [
  {
    detail: {
      description: "BASIX certificate",
      mapsToType: ComplianceDocumentType.BASIX_CERTIFICATE,
    },
    documentType: ComplianceDocumentType.CHECKLIST_ITEM,
    files: [],
    id: "line_basix",
    status: "PENDING",
  },
  {
    detail: null,
    documentType: ComplianceDocumentType.SURVEY,
    files: [file("f_survey", "Survey.pdf")],
    id: "doc_survey",
    status: "RECEIVED",
  },
  {
    detail: null,
    documentType: ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
    files: [file("f_cert", "Certificate 10.7.pdf")],
    id: "doc_cert",
    status: "RECEIVED",
  },
  {
    detail: null,
    documentType: ComplianceDocumentType.LAND_DEED,
    files: [file("f_deed", "Deed.pdf")],
    id: "doc_deed",
    status: "RECEIVED",
  },
];

const assessor = {
  additionalEmails: [],
  email: "assess@basix.example",
  id: "tradie_basix",
  name: "Basix Assessors Pty Ltd",
  phone: null,
  trade: "BASIX Assessment",
};

function script(
  outreaches: readonly unknown[] = [],
  extras: (args: unknown) => unknown[] = () => [],
) {
  return {
    "certifierEngagement.findUnique": {
      alerts: [],
      documents,
      emails: [],
      externalApplications: [],
      id: "engagement_1",
      outreaches,
      subjectAddress: "Lot 9028 Sommerville Drive, Catherine Field NSW 2557",
    },
    "complianceOutreach.create": (args: unknown) => ({
      id: "outreach_1",
      ...(args as { data: Record<string, unknown> }).data,
    }),
    "file.findMany": extras,
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
    "tradie.findMany": [assessor],
    "tradie.findUnique": assessor,
  };
}

const basix = (
  overrides: Partial<SendComplianceOutreachInput> = {},
): SendComplianceOutreachInput => ({
  body: "<p>Could you assess this lot?</p>",
  deliverables: [],
  extraAttachmentIds: [],
  party: CompliancePartyType.BASIX_CONSULTANT,
  projectId,
  tradieId: assessor.id,
  ...overrides,
});

/** What the send hands the mail port, for the same input. */
async function emailed(
  input: SendComplianceOutreachInput,
  extras?: (args: unknown) => unknown[],
) {
  let names: string[] = [];
  await sendComplianceOutreach(
    adminPrincipal(),
    input,
    recordingDb(script([], extras)).transactionalDb,
    async ({ attachments }) => {
      names = attachments.map((attachment) => attachment.name);
    },
  );
  return names;
}

async function previewed(
  input: SendComplianceOutreachInput,
  extras?: (args: unknown) => unknown[],
) {
  return previewOutreachAttachments(
    adminPrincipal(),
    input,
    recordingDb(script([], extras)).db,
  );
}

test("the pack is attached with no argument asking for it, and the preview says so", async () => {
  const expected = ["Survey.pdf", "Certificate 10.7.pdf"];

  assert.deepEqual(await emailed(basix()), expected);
  assert.deepEqual(await previewed(basix()), expected);
});

test("omitting a pack file leaves it off the email and the preview alike", async () => {
  const input = basix({ omitAttachmentIds: ["f_cert"] });

  assert.deepEqual(await emailed(input), ["Survey.pdf"]);
  assert.deepEqual(await previewed(input), ["Survey.pdf"]);
});

test("omitting the whole pack sends no attachments", async () => {
  const input = basix({ omitAttachmentIds: ["f_survey", "f_cert"] });

  assert.deepEqual(await emailed(input), []);
  assert.deepEqual(await previewed(input), []);
});

test("an extra file is added after the pack, once, even when it is also a pack file", async () => {
  const extras = () => [
    file("f_cert", "Certificate 10.7.pdf"),
    file("f_deed", "Deed.pdf"),
  ];
  const input = basix({ extraAttachmentIds: ["f_cert", "f_deed"] });
  const expected = ["Survey.pdf", "Certificate 10.7.pdf", "Deed.pdf"];

  assert.deepEqual(await emailed(input, extras), expected);
  assert.deepEqual(await previewed(input, extras), expected);
});

test("an extra file is only looked up inside this project", async () => {
  const wheres: unknown[] = [];
  const engagement = script()["certifierEngagement.findUnique"];
  await outreachAttachments(
    engagement as never,
    {
      extraAttachmentIds: ["f_elsewhere"],
      party: CompliancePartyType.BASIX_CONSULTANT,
      projectId,
    },
    recordingDb({
      ...script(),
      "file.findMany": (args: unknown) => {
        wheres.push((args as { where: unknown }).where);
        return [];
      },
    }).db,
  );

  assert.deepEqual(wheres, [
    {
      id: { in: ["f_elsewhere"] },
      OR: [
        { projectId },
        { complianceDocument: { engagement: { projectId } } },
      ],
    },
  ]);
});

test("the approval card's lookup is the same list, and only for an outreach", async () => {
  const db = recordingDb(script()).db;
  const outreach = {
    body: "<p>Hi</p>",
    omitAttachmentIds: ["f_survey"],
    party: CompliancePartyType.BASIX_CONSULTANT,
    projectId,
  };

  assert.deepEqual(
    await describeOutreachAttachments(adminPrincipal(), outreach, db),
    ["Certificate 10.7.pdf"],
  );
  // A follow-up carries a body and a project but no party: not an outreach.
  assert.equal(
    await describeOutreachAttachments(
      adminPrincipal(),
      { alertId: "alert_1", body: "<p>Hi</p>", projectId },
      db,
    ),
    null,
  );
  assert.equal(
    await describeOutreachAttachments(
      adminPrincipal(),
      { ...outreach, party: "NOT_A_PARTY" },
      db,
    ),
    null,
  );
});

test("prepare lists the files, by id, so Eve can say what will go and omit one", async () => {
  const prepared = await prepareComplianceOutreach(
    adminPrincipal(),
    { party: CompliancePartyType.BASIX_CONSULTANT, projectId },
    recordingDb(script()).db,
  );

  assert.equal(prepared.available, true);
  if (!prepared.available) return;
  assert.deepEqual(
    prepared.attachments.map((entry) => [entry.id, entry.name]),
    [
      ["f_survey", "Survey.pdf"],
      ["f_cert", "Certificate 10.7.pdf"],
    ],
  );
});

test("prepare blocks a party the client supplies, and the send agrees", async () => {
  const selfSupplied = [
    {
      checklistDocumentId: null,
      contactEmail: null,
      id: "outreach_9",
      mode: ComplianceOutreachMode.SELF_SUPPLIED,
      party: CompliancePartyType.BASIX_CONSULTANT,
      status: ComplianceOutreachStatus.NOT_SENT,
    },
  ];

  const prepared = await prepareComplianceOutreach(
    adminPrincipal(),
    { party: CompliancePartyType.BASIX_CONSULTANT, projectId },
    recordingDb(script(selfSupplied)).db,
  );
  assert.equal(prepared.available && prepared.canSend, false);
  assert.match(
    (prepared.available && prepared.blocked) || "",
    /marked self-supplied/,
  );

  await assert.rejects(
    sendComplianceOutreach(
      adminPrincipal(),
      basix(),
      recordingDb(script(selfSupplied)).transactionalDb,
      async () => undefined,
    ),
    (error) =>
      error instanceof DomainTransitionError
      && /marked self-supplied/.test(error.message),
  );
});

test("prepare blocks an opening outreach to a party already written to", async () => {
  const sent = [
    {
      checklistDocumentId: null,
      contactEmail: "earlier@basix.example",
      id: "outreach_9",
      mode: ComplianceOutreachMode.OUTREACH,
      party: CompliancePartyType.BASIX_CONSULTANT,
      status: ComplianceOutreachStatus.SENT,
    },
  ];

  const prepared = await prepareComplianceOutreach(
    adminPrincipal(),
    { party: CompliancePartyType.BASIX_CONSULTANT, projectId },
    recordingDb(script(sent)).db,
  );

  assert.match(
    (prepared.available && prepared.blocked) || "",
    /already written to at earlier@basix\.example; send a follow-up/,
  );
});
