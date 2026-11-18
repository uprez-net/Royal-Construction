import assert from "node:assert/strict";
import { test } from "vitest";

import {
  documentPassage,
  loadFileSources,
  replyAttachments,
  urlHash,
  type FileSource,
} from "@/lib/domain/agent-context/file-sources";

import {
  LEAD_ID,
  OFFER_ID,
  PROJECT_ID,
  fileRow,
  memoryDb,
  now,
} from "./document-index-fixtures";

// Which lead, project and offer each uploaded document is filed under.

test("each document is tagged with its lead, project and offer", async () => {
  const { db } = memoryDb([
    fileRow({ id: "survey", milestone: { projectId: PROJECT_ID } }),
    fileRow({ id: "brief", leadId: LEAD_ID }),
    fileRow({
      id: "signed",
      leadId: LEAD_ID,
      tags: ["Offer", "Signed", "Tender"],
      url: "https://blob.example/signed-tender.pdf",
    }),
  ]);
  const sources = await loadFileSources(db, now);
  const byKey = Object.fromEntries(sources.map((s) => [s.sourceKey, s]));

  // A milestone's file belongs to the project, and so to the lead it came from.
  assert.equal(byKey["file:survey"]?.projectId, PROJECT_ID);
  assert.equal(byKey["file:survey"]?.leadId, LEAD_ID);
  assert.equal(byKey["file:survey"]?.offerId, null);
  // A lead's file follows the lead to its project.
  assert.equal(byKey["file:brief"]?.projectId, PROJECT_ID);
  // The signed Tender names its offer by URL.
  assert.equal(byKey["file:signed"]?.offerId, OFFER_ID);
  assert.equal(byKey["file:signed"]?.offerReference, "OF-42");
});

test("a client's reply attachment is tagged with the offer it answers", async () => {
  const { db } = memoryDb(
    [],
    [
      {
        attachments: [
          {
            contentType: "application/pdf",
            name: "markup.pdf",
            size: 10,
            url: "https://blob.example/markup.pdf",
          },
          {
            contentType: "image/png",
            name: "lost.png",
            note: "too large",
            url: null,
          },
        ],
        fromEmail: "jordan@example.com",
        id: "reply-1",
        receivedAt: new Date("2026-11-10T00:00:00Z"),
        send: {
          offer: { baseReference: "OF-42", id: OFFER_ID, leadId: LEAD_ID },
        },
      },
    ],
  );
  const [source, ...rest] = await loadFileSources(db, now);
  assert.equal(rest.length, 0, "an attachment that was not stored is skipped");
  assert.equal(source?.sourceKey, "offer-reply:reply-1:0");
  assert.equal(source?.offerId, OFFER_ID);
  assert.equal(source?.leadId, LEAD_ID);
  assert.equal(source?.projectId, PROJECT_ID);
  assert.deepEqual(replyAttachments("not a list"), []);
});

test("a compliance line's copy of a document is read once, not twice", async () => {
  const shared = "https://blob.example/title-search.pdf";
  const { db } = memoryDb([
    fileRow({
      createdAt: new Date("2026-11-02T00:00:00Z"),
      id: "copy",
      complianceDocument: { engagement: { projectId: PROJECT_ID } },
      url: shared,
    }),
    fileRow({ id: "original", projectId: PROJECT_ID, url: shared }),
  ]);
  const sources = await loadFileSources(db, now);
  assert.deepEqual(
    sources.map((s) => s.sourceKey),
    ["file:copy"],
  );
});

test("a passage is headed with its document and records, reproducibly", () => {
  const source: FileSource = {
    addedAt: new Date("2026-09-24T14:00:00.000Z"),
    fileId: "survey",
    filename: "Survey.pdf",
    leadId: LEAD_ID,
    leadName: "Jordan Smith",
    mediaType: "application/pdf",
    offerId: null,
    offerReference: null,
    offerReplyId: null,
    origin: "Project › Compliance › Surveyor documents › Survey",
    projectId: PROJECT_ID,
    projectName: "12 Rose St",
    sizeBytes: 1_000,
    sourceKey: "file:survey",
    tags: ["Compliance", "Survey"],
    url: "https://blob.example/survey.pdf",
    urlHash: urlHash("https://blob.example/survey.pdf"),
  };
  assert.equal(
    documentPassage(
      source,
      { pageFrom: 3, pageTo: 4, text: "Rated BAL-29." },
      12,
    ),
    [
      "Document: Survey.pdf (pages 3–4 of 12)",
      "From: Project › Compliance › Surveyor documents › Survey",
      "Tags: Compliance, Survey",
      "For: Project 12 Rose St · Lead Jordan Smith",
      "Added: Fri 25 Sept 2026",
      "",
      "Rated BAL-29.",
      "",
      `Refs: fileId=survey projectId=${PROJECT_ID} leadId=${LEAD_ID}`,
    ].join("\n"),
  );
});
