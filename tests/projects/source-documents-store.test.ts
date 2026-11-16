import assert from "node:assert/strict";
import { test } from "vitest";

import { DomainValidationError } from "@/lib/domain/errors";
import { assertSourceDocumentsInStore } from "@/lib/domain/projects/source-documents";

// The create-project schema accepts any valid URL, and the offer handoff calls
// the writer without the schema, so the writer pins the store (#284).

const STORE = "abc123";
const own = (name: string) =>
  `https://${STORE}.public.blob.vercel-storage.com/${name}`;
const doc = (kind: "tender" | "contract", url: string) => ({
  fileId: "f1",
  fileName: `${kind}.pdf`,
  kind,
  url,
});

test("documents in this deployment's own store pass", () => {
  assertSourceDocumentsInStore(
    {
      contract: doc("contract", own("c.pdf")),
      tender: doc("tender", own("t.pdf")),
    },
    STORE,
  );
});

test("another Vercel Blob account's file is refused, per document", () => {
  const stranger = "https://zzz999.public.blob.vercel-storage.com/x.pdf";
  for (const documents of [
    {
      contract: doc("contract", own("c.pdf")),
      tender: doc("tender", stranger),
    },
    {
      contract: doc("contract", stranger),
      tender: doc("tender", own("t.pdf")),
    },
  ]) {
    assert.throws(
      () => assertSourceDocumentsInStore(documents, STORE),
      (error) =>
        error instanceof DomainValidationError
        && /must be a file uploaded to this app/.test(error.message),
    );
  }
});

test("an arbitrary address is refused", () => {
  assert.throws(
    () =>
      assertSourceDocumentsInStore(
        {
          contract: doc("contract", own("c.pdf")),
          tender: doc("tender", "http://169.254.169.254/latest/meta-data"),
        },
        STORE,
      ),
    DomainValidationError,
  );
});

test("with no store id (a missing or malformed token) everything is refused", () => {
  assert.throws(
    () =>
      assertSourceDocumentsInStore(
        {
          contract: doc("contract", own("c.pdf")),
          tender: doc("tender", own("t.pdf")),
        },
        null,
      ),
    DomainValidationError,
  );
});
