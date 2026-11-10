import assert from "node:assert/strict";
import { test } from "vitest";

import { dismissUnidentifiedComplianceDocument } from "@/lib/domain/compliance/dismiss-arrival";
import { DomainNotFoundError } from "@/lib/domain/errors";
import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

const LOGO = "https://blob.example/projects/p1/logo.png";
const PLANS = "https://blob.example/projects/p1/plans.pdf";
const INPUT = { projectId: "p1", documentId: "doc_logo" };

function blobRecorder() {
  const deleted: unknown[] = [];
  return {
    deleted,
    deleteBlob: async (url: string | readonly string[]) => {
      deleted.push(url);
    },
  };
}

test("an identified or missing document is refused and nothing is touched", async () => {
  const recorder = recordingDb({ "complianceDocument.findFirst": null });
  const blob = blobRecorder();

  await assert.rejects(
    dismissUnidentifiedComplianceDocument(
      adminPrincipal(),
      INPUT,
      recorder.transactionalDb,
      blob,
    ),
    DomainNotFoundError,
  );
  assert.deepEqual(recorder.writes(), []);
  assert.deepEqual(blob.deleted, []);
});

test("only an admin may dismiss", async () => {
  const recorder = recordingDb();
  const blob = blobRecorder();

  await assert.rejects(
    dismissUnidentifiedComplianceDocument(
      siteManagerPrincipal(),
      INPUT,
      recorder.transactionalDb,
      blob,
    ),
  );
  assert.deepEqual(recorder.writes(), []);
  assert.deepEqual(blob.deleted, []);
});

test("dismissing unlinks the file from the inbound mail and frees its storage", async () => {
  const recorder = recordingDb({
    "complianceDocument.findFirst": {
      id: "doc_logo",
      engagementId: "eng_1",
      files: [{ id: "file_logo", url: LOGO, filename: "image001.png" }],
    },
    "certifierEmail.findMany": (args: unknown) => {
      const where = (args as { where: { direction?: string } }).where;
      // The dismissal reads inbound mail to unlink; the reclamation then reads
      // the whole trail, which no longer links at the logo.
      return where.direction
        ? [
            {
              id: "mail_1",
              attachments: [
                { name: "image001.png", url: LOGO },
                { name: "plans.pdf", url: PLANS },
              ],
            },
            { id: "mail_2", attachments: [{ name: "plans.pdf", url: PLANS }] },
          ]
        : [{ attachments: [{ name: "plans.pdf", url: PLANS }] }];
    },
    "file.findMany": [],
  });
  const blob = blobRecorder();

  const outcome = await dismissUnidentifiedComplianceDocument(
    adminPrincipal(),
    INPUT,
    recorder.transactionalDb,
    blob,
  );

  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["certifierEmail.update", "file.deleteMany", "complianceDocument.delete"],
  );
  // Only the message that linked at the logo is rewritten, and it keeps the plans.
  assert.deepEqual(recorder.writes()[0].args, {
    where: { id: "mail_1" },
    data: { attachments: [{ name: "plans.pdf", url: PLANS }] },
  });
  assert.deepEqual(blob.deleted, [[LOGO]]);
  assert.equal(outcome.reclaimed, 1);
  assert.deepEqual(outcome.fileNames, ["image001.png"]);
});
