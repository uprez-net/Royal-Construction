import assert from "node:assert/strict";
import { ComplianceDocumentType, Role } from "@prisma/client";
import { test } from "vitest";

import { resolveUploadHints } from "@/components/common/upload-hints";
import { saveFile } from "@/lib/domain/files";
import {
  MAX_FILE_TAGS,
  inferFileTags,
  joinFileOrigin,
  normalizeFileOrigin,
  normalizeFileTags,
} from "@/lib/domain/file-tags";
import {
  describeProjectFile,
  mergeDocumentsByUrl,
} from "@/lib/domain/projects/document-tags";
import { readProjectDocuments } from "@/lib/domain/projects/documents";
import {
  displayFileName,
  fileKind,
  isWithinWindow,
  parseDateInput,
} from "@/lib/files/file-filters";
import {
  activityCategory,
  activityTitle,
} from "@/lib/projects/activity-categories";
import { recordingDb } from "../architecture/domain-harness";

const admin = { kind: "user" as const, role: Role.ADMIN, userId: "u_1" };

test("tags are trimmed, collapsed, de-duplicated case-insensitively and capped", () => {
  assert.deepEqual(
    normalizeFileTags(
      ["  Compliance ", "compliance", "Survey\nreport", "", 42, null],
      ["SURVEY report", "Milestone"],
    ),
    ["Compliance", "Survey report", "Milestone"],
  );
  const many = Array.from({ length: 30 }, (_, index) => `Tag ${index}`);
  assert.equal(normalizeFileTags(many).length, MAX_FILE_TAGS);
});

test("an overlong tag or origin is cut, not stored whole", () => {
  const [tag] = normalizeFileTags(["x".repeat(500)]);
  assert.ok(tag.length <= 48);
  assert.ok(tag.endsWith("…"));
  assert.ok(normalizeFileOrigin("y".repeat(900))!.length <= 200);
  assert.equal(normalizeFileOrigin("   "), null);
});

test("an origin trail skips empty steps", () => {
  assert.equal(
    joinFileOrigin(["Project", "", null, "Compliance", false, "Survey"]),
    "Project › Compliance › Survey",
  );
  assert.equal(joinFileOrigin([]), null);
});

test("nested screen scopes and a control's own hints make one trail", () => {
  const scope = { tags: ["Compliance"], trail: ["Project", "Compliance"] };
  assert.deepEqual(
    resolveUploadHints(scope, { tags: ["Survey"], trail: ["Survey"] }),
    { tags: ["Compliance", "Survey"], origin: "Project › Compliance › Survey" },
  );
  // A modal names its whole trail, so it reads the same opened from anywhere.
  assert.equal(
    resolveUploadHints(scope, {
      rootTrail: true,
      trail: ["Project", "Site update"],
    }).origin,
    "Project › Site update",
  );
});

test("saveFile stores the browser's hints only after normalising them", async () => {
  const recorder = recordingDb({
    "user.findUnique": { customerId: null, id: "u_1", role: Role.ADMIN },
    "project.findUnique": { customerId: "c_1" },
    "file.create": { id: "f_1" },
  });
  await saveFile(
    admin,
    {
      fileName: "survey.pdf",
      fileSize: 12,
      fileType: "application/pdf",
      fileUrl: "https://blob.test/survey.pdf",
      projectId: "p_1",
      userId: "u_1",
      tags: [" Compliance", "compliance", "Survey"],
      origin: "  Project › Compliance  ",
    },
    recorder.db,
  );
  const data = (recorder.writes()[0].args as { data: Record<string, unknown> })
    .data;
  assert.deepEqual(data.tags, ["Compliance", "Survey"]);
  assert.equal(data.origin, "Project › Compliance");
});

test("a file name says what it is in whole words only", () => {
  assert.deepEqual(
    inferFileTags("Executed-Tender-RC12.pdf", "application/pdf"),
    ["Tender"],
  );
  assert.deepEqual(inferFileTags("planning-certificate.pdf", null), [
    "Certificate",
  ]);
  assert.deepEqual(inferFileTags("site.jpg", "image/jpeg"), ["Photo"]);
});

const baseFile = {
  id: "f_1",
  filename: "survey.pdf",
  fileType: "application/pdf",
  filesize: 1024,
  url: "https://blob.test/survey.pdf",
  createdAt: new Date("2026-11-01T00:00:00Z"),
  projectId: "p_1",
  milestoneId: null,
  leadId: null,
  incidentId: null,
  complianceDocumentId: null,
  tags: ["Compliance"],
  origin: "Project › Compliance › Survey",
};

test("a compliance file is tagged with its document and party, and is not deletable here", () => {
  const document = describeProjectFile(
    { ...baseFile, complianceDocumentId: "cd_1" },
    {
      projectId: "p_1",
      compliance: { documentType: ComplianceDocumentType.SURVEY, label: null },
    },
  );
  assert.equal(document.source, "compliance");
  assert.ok(document.tags.includes("Survey"));
  assert.ok(document.tags.includes("Surveyor"));
  assert.equal(document.deletable, false);
  assert.equal(document.origin, "Project › Compliance › Survey");
});

test("a project's own upload is deletable; a lead's carried-over copy is labelled", () => {
  assert.equal(
    describeProjectFile(baseFile, { projectId: "p_1" }).deletable,
    true,
  );
  const fromLead = describeProjectFile(
    { ...baseFile, leadId: 7 },
    { projectId: "p_1" },
  );
  assert.equal(fromLead.source, "lead");
  assert.ok(fromLead.tags.includes("From lead"));
});

test("copies of one stored object list once, with every copy's tags, and cannot be deleted", () => {
  const original = describeProjectFile(baseFile, { projectId: "p_1" });
  const copy = describeProjectFile(
    {
      ...baseFile,
      id: "f_2",
      complianceDocumentId: "cd_1",
      tags: ["Checklist"],
    },
    { projectId: "p_1" },
  );
  const merged = mergeDocumentsByUrl([original, copy]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].fileId, "f_1");
  assert.ok(merged[0].tags.includes("Checklist"));
  assert.equal(merged[0].deletable, false);
});

test("the Documents tab reads files, tradie invoices and variations into one list", async () => {
  const { db } = recordingDb({
    "file.findMany": [
      {
        ...baseFile,
        User: { name: "Office" },
        milestone: null,
        complianceDocument: null,
        incident: null,
      },
    ],
    "tradieInvoice.findMany": [
      {
        id: "ti_1",
        documentUrl: "https://blob.test/inv.pdf",
        documentName: "inv.pdf",
        invoiceNumber: "42",
        status: "AUTHORISED",
        createdAt: new Date("2026-11-03T00:00:00Z"),
        tradie: { name: "Sparky" },
        enteredBy: null,
        schedule: { milestone: { id: "m_1", name: "Slab" } },
      },
    ],
    "tradieInvoiceInbox.findMany": [],
    "variation.findMany": [
      {
        id: "v_1",
        number: 3,
        documentUrl: "https://blob.test/v3.pdf",
        sentAt: null,
        createdAt: new Date("2026-11-02T00:00:00Z"),
        milestone: null,
        raisedBy: null,
      },
    ],
  });
  const rows = await readProjectDocuments({ id: "p_1", leadId: 7 }, db);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["tradie-invoice:ti_1", "variation:v_1", "f_1"],
  );
  assert.ok(rows[0].tags.includes("Sparky"));
  assert.equal(rows[0].milestoneName, "Slab");
  assert.equal(rows[1].name, "V-003.pdf");
});

test("files sort into kinds by MIME type, then by extension", () => {
  assert.equal(fileKind("application/pdf", "x"), "pdf");
  assert.equal(fileKind(null, "photo.HEIC"), "image");
  assert.equal(
    fileKind(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "x",
    ),
    "spreadsheet",
  );
  assert.equal(fileKind("", "notes"), "other");
});

test("time windows count whole days back from today, and a custom range includes both ends", () => {
  const now = new Date(2026, 10, 6, 15, 0);
  assert.equal(isWithinWindow(new Date(2026, 10, 6, 0, 1), "today", now), true);
  assert.equal(
    isWithinWindow(new Date(2026, 10, 5, 23, 59), "today", now),
    false,
  );
  assert.equal(isWithinWindow(new Date(2026, 9, 31, 0, 0), "7d", now), true);
  assert.equal(isWithinWindow(new Date(2026, 9, 30, 23, 0), "7d", now), false);
  assert.equal(isWithinWindow(new Date(2026, 0, 1), "older", now), true);
  const range = { from: "2026-11-01", to: "2026-11-03" };
  assert.equal(
    isWithinWindow(new Date(2026, 10, 3, 23, 0), "custom", now, range),
    true,
  );
  assert.equal(
    isWithinWindow(new Date(2026, 10, 4, 0, 0), "custom", now, range),
    false,
  );
  assert.equal(parseDateInput("not-a-date"), null);
  assert.equal(isWithinWindow(new Date(2020, 0, 1), null, now), true);
});

test("history entries are grouped by what they are about", () => {
  assert.equal(activityCategory("complianceDocumentUploaded"), "compliance");
  assert.equal(activityCategory("fileUploaded"), "documents");
  assert.equal(activityCategory("file-deleted"), "documents");
  assert.equal(activityCategory("tradieScheduleCreated"), "tradies");
  assert.equal(activityCategory("siteManagerAssigned"), "project");
  assert.equal(activityCategory("site-update"), "site");
  assert.equal(activityCategory("variationCreated"), "variations");
  assert.equal(activityCategory("invoiceRecorded"), "financials");
  assert.equal(activityCategory("somethingNew"), "other");
  assert.equal(activityTitle("fileUploaded"), "Document uploaded");
  assert.equal(
    activityTitle("complianceDocumentApproved"),
    "Compliance document approved",
  );
});

test("stored names lose their upload id and storage suffix on screen only", () => {
  assert.equal(
    displayFileName(
      "24e19b97-d9f4-4c3d-96da-a387ed5f49c2-Lot-9028-signed-tender--Xzt8gvtlN5S8tIRvSWi6J9NqSKQKfm.pdf",
    ),
    "Lot-9028-signed-tender.pdf",
  );
  assert.equal(
    displayFileName("Contract_for_Lot_9028-3dFkq4ulw6vWCA9lyIPCA9wQvoNoy1.pdf"),
    "Contract_for_Lot_9028.pdf",
  );
  assert.equal(displayFileName("Wheat St Tender.pdf"), "Wheat St Tender.pdf");
  // A long ordinary word is part of the name, not a storage suffix.
  assert.equal(
    displayFileName("Site-Intercontinentalisation.pdf"),
    "Site-Intercontinentalisation.pdf",
  );
});
