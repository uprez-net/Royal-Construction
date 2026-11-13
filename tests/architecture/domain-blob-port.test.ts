import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { deleteLeadFile } from "@/lib/domain/files";
import {
  deleteEmailAttachment,
  authorizeEmailAttachmentDeletion,
} from "@/lib/domain/email/operations";
import { reclaimSupersededComplianceFiles } from "@/lib/domain/compliance/file-reclamation";
import {
  DomainAuthorizationError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { ROOT } from "./module-graph";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "./domain-harness";

// Phase 7: blob storage is a capability the domain is handed, not a package an
// adapter reaches for after being told a URL is in scope.
//
// The difference these tests exist for: when the rule and the effect sat in
// different files, nothing proved the adapter acted on the answer, and nothing
// could prove the delete did NOT happen on a refusal. Now the refusal and the
// absence of the effect are the same assertion.

const read = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const BLOB = "https://store.public.blob.vercel-storage.com";

test("a lead file delete refuses a blob outside the lead, and deletes nothing", async () => {
  const deleted: string[] = [];
  const port = async (url: string | readonly string[]) => {
    deleted.push(...(Array.isArray(url) ? url : [url as string]));
  };

  const recorder = recordingDb({ "lead.findUnique": { id: 7 } });
  await assert.rejects(
    () =>
      deleteLeadFile(
        adminPrincipal(),
        { blobUrl: `${BLOB}/leads/9/quote.pdf`, leadId: 7 },
        recorder.db,
        port,
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(deleted, [], "a refused delete must not reach storage");

  await deleteLeadFile(
    adminPrincipal(),
    { blobUrl: `${BLOB}/leads/7/quote.pdf`, leadId: 7 },
    recordingDb({ "lead.findUnique": { id: 7 } }).db,
    port,
  );
  assert.deepEqual(deleted, [`${BLOB}/leads/7/quote.pdf`]);
});

test("a lead file delete refuses a caller who cannot open the lead", async () => {
  const deleted: string[] = [];
  await assert.rejects(
    () =>
      deleteLeadFile(
        customerPrincipal(),
        { blobUrl: `${BLOB}/leads/7/quote.pdf`, leadId: 7 },
        recordingDb({ "lead.findUnique": null }).db,
        async (url) => {
          deleted.push(String(url));
        },
      ),
    (error) => error instanceof Error,
  );
  assert.deepEqual(deleted, []);
});

test("a lead file delete rejects an unparseable id before touching storage", async () => {
  const deleted: string[] = [];
  await assert.rejects(
    () =>
      deleteLeadFile(
        adminPrincipal(),
        { blobUrl: `${BLOB}/leads/7/quote.pdf`, leadId: "not-a-number" },
        recordingDb().db,
        async (url) => {
          deleted.push(String(url));
        },
      ),
    DomainValidationError,
  );
  assert.deepEqual(deleted, []);
});

test("an email attachment delete is confined to the composer's own prefix", async () => {
  const deleted: string[] = [];
  const port = async (url: string | readonly string[]) => {
    deleted.push(String(url));
  };

  // A signed contract in the same store is not this action's to remove.
  await assert.rejects(
    () =>
      deleteEmailAttachment(
        adminPrincipal(),
        `${BLOB}/offers/12/contract-executed.pdf`,
        port,
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(deleted, []);

  await deleteEmailAttachment(
    adminPrincipal(),
    `${BLOB}/email-ad-hock-attachment-upload/brochure.pdf`,
    port,
  );
  assert.deepEqual(deleted, [
    `${BLOB}/email-ad-hock-attachment-upload/brochure.pdf`,
  ]);

  // The rule is still assertable on its own for a caller that only needs the
  // answer.
  assert.deepEqual(
    authorizeEmailAttachmentDeletion(
      adminPrincipal(),
      `${BLOB}/email-ad-hock-attachment-upload/brochure.pdf`,
    ),
    { blobUrl: `${BLOB}/email-ad-hock-attachment-upload/brochure.pdf` },
  );
});

test("an email attachment delete refuses a caller who is not staff", async () => {
  const deleted: string[] = [];
  await assert.rejects(
    () =>
      deleteEmailAttachment(
        customerPrincipal(),
        `${BLOB}/email-ad-hock-attachment-upload/brochure.pdf`,
        async (url) => {
          deleted.push(String(url));
        },
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(deleted, []);
});

test("superseded compliance files keep anything the mail trail links at", async () => {
  const deleted: string[][] = [];
  const recorder = recordingDb({
    "certifierEmail.findMany": [
      { attachments: [{ name: "fee.pdf", url: `${BLOB}/compliance/fee.pdf` }] },
    ],
    "file.findMany": [],
  });

  const outcome = await reclaimSupersededComplianceFiles(
    "eng_1",
    [
      { id: "f_1", url: `${BLOB}/compliance/fee.pdf` },
      { id: "f_2", url: `${BLOB}/compliance/cdc.pdf` },
    ],
    recorder.db,
    async (urls) => {
      deleted.push(Array.isArray(urls) ? [...urls] : [urls as string]);
    },
  );

  assert.deepEqual(outcome.keptOnThread, [`${BLOB}/compliance/fee.pdf`]);
  assert.deepEqual(outcome.reclaimed, [`${BLOB}/compliance/cdc.pdf`]);
  // Emailing a copy of the conversation must not leave a dead link in it.
  assert.deepEqual(deleted, [[`${BLOB}/compliance/cdc.pdf`]]);
});

test("superseded compliance files keep anything another row still points at", async () => {
  const deleted: string[][] = [];
  const recorder = recordingDb({
    "certifierEmail.findMany": [],
    "file.findMany": [{ url: `${BLOB}/compliance/shared.pdf` }],
  });

  const outcome = await reclaimSupersededComplianceFiles(
    "eng_1",
    [
      { id: "f_1", url: `${BLOB}/compliance/shared.pdf` },
      { id: "f_2", url: `${BLOB}/compliance/only.pdf` },
    ],
    recorder.db,
    async (urls) => {
      deleted.push(Array.isArray(urls) ? [...urls] : [urls as string]);
    },
  );

  assert.deepEqual(outcome.keptShared, [`${BLOB}/compliance/shared.pdf`]);
  assert.deepEqual(outcome.reclaimed, [`${BLOB}/compliance/only.pdf`]);
  assert.deepEqual(deleted, [[`${BLOB}/compliance/only.pdf`]]);
});

test("nothing to reclaim touches neither the database nor storage", async () => {
  const deleted: unknown[] = [];
  const recorder = recordingDb();
  const outcome = await reclaimSupersededComplianceFiles(
    "eng_1",
    [],
    recorder.db,
    async (urls) => {
      deleted.push(urls);
    },
  );
  assert.deepEqual(outcome.reclaimed, []);
  assert.deepEqual(recorder.operations(), []);
  assert.deepEqual(deleted, []);
});

test("the adapters hand over the shared Blob capability rather than importing del", () => {
  for (const path of [
    "lib/data/email-ad-hock.ts",
    "lib/compliance/document-replacement.ts",
  ]) {
    const source = read(path);
    assert.match(
      source,
      /vercelBlobDelete/,
      `${path} should pass the shared Blob port`,
    );
    assert.doesNotMatch(
      source,
      /from "@vercel\/blob"/,
      `${path} should not reach for the Blob SDK itself`,
    );
  }

  // One implementation of the capability, so swapping providers is one edit.
  // The SDK is reached only through lib/blob.ts, which also reports a failed
  // call; the port goes through it rather than around it.
  assert.match(read("lib/blob.ts"), /from "@vercel\/blob"/);
  assert.match(read("lib/blob-port.ts"), /from "@\/lib\/blob"/);
  assert.doesNotMatch(read("lib/blob-port.ts"), /from "@vercel\/blob"/);
});
