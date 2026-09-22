import assert from "node:assert/strict";
import test from "node:test";

import {
  CertifierEmailDirection,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";

import { hasSentCurrentDocument } from "../../lib/domain/compliance/required-pack";
import { buildPartyRevisionBody } from "../../lib/domain/compliance/party-outreach-email";
import type {
  CertifierEngagementDetail,
  ComplianceDocumentWithFiles,
} from "../../types/compliance";
import { partyReplySchema } from "../../utils/validators/compliance";

const documentWith = (url?: string) =>
  ({
    id: "checklist-item",
    documentType: ComplianceDocumentType.CHECKLIST_ITEM,
    status: ComplianceDocumentStatus.UPLOADED,
    files: url
      ? [
          {
            id: "file",
            url,
            filename: "report.pdf",
            fileType: "application/pdf",
          },
        ]
      : [],
  }) as unknown as ComplianceDocumentWithFiles;

const engagementWith = (
  direction: CertifierEmailDirection,
  attachmentUrl: string,
) =>
  ({
    emails: [
      {
        direction,
        attachments: [{ name: "report.pdf", url: attachmentUrl }],
      },
    ],
  }) as unknown as CertifierEngagementDetail;

test("a checklist item is sent only when its current file is in the outbound trail", () => {
  const engagement = engagementWith(
    CertifierEmailDirection.OUTBOUND,
    "https://blob.test/current.pdf",
  );

  assert.equal(
    hasSentCurrentDocument(
      engagement,
      documentWith("https://blob.test/current.pdf"),
    ),
    true,
  );
  assert.equal(
    hasSentCurrentDocument(
      engagement,
      documentWith("https://blob.test/replacement.pdf"),
    ),
    false,
    "a replacement is unsent until its own URL appears on a message",
  );
});

test("an inbound attachment and an empty row do not count as sent", () => {
  const engagement = engagementWith(
    CertifierEmailDirection.INBOUND,
    "https://blob.test/current.pdf",
  );

  assert.equal(
    hasSentCurrentDocument(
      engagement,
      documentWith("https://blob.test/current.pdf"),
    ),
    false,
  );
  assert.equal(hasSentCurrentDocument(engagement, documentWith()), false);
});

test("the revision draft safely includes the certifier's reason", () => {
  const body = buildPartyRevisionBody({
    contactName: "Alex <Director>",
    subjectAddress: "1 & 2 Test Street",
    documentLabel: "Bushfire report",
    rejectionReason: "Revise BAL <40 & attach schedule>",
  });

  assert.match(body, /Alex &lt;Director&gt;/);
  assert.match(body, /1 &amp; 2 Test Street/);
  assert.match(body, /Revise BAL &lt;40 &amp; attach schedule&gt;/);
  assert.doesNotMatch(body, /<40 & attach/);
});

test("party replies accept rich HTML and trusted extra attachment ids", () => {
  const parsed = partyReplySchema.parse({
    outreachId: "d33858e8-8c29-42de-b306-0f7934b651b3",
    body: "<p>Please revise this.</p>",
    bodyFormat: "html",
    attachments: [],
    extraAttachmentIds: ["9bcab386-6807-4f70-bf77-b54015fc6a0f"],
  });

  assert.equal(parsed.bodyFormat, "html");
  assert.equal(parsed.extraAttachmentIds?.length, 1);
});
