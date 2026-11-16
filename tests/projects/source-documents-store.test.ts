import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { DomainValidationError } from "@/lib/domain/errors";
import { createProjectFromLead } from "@/lib/domain/projects/creation";
import { assertProjectDocumentsInStore } from "@/lib/domain/projects/source-documents";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// The create-project schema accepts any valid URL, and the offer handoff and
// Eve reach the command without the schema, so the command pins the store and
// checks every place a reference can arrive (#284).

const STORE = "abc123";
const own = (name: string) =>
  `https://${STORE}.public.blob.vercel-storage.com/${name}`;
const STRANGER = "https://zzz999.public.blob.vercel-storage.com/x.pdf";
const doc = (kind: "tender" | "contract", url: string) => ({
  fileId: "f1",
  fileName: `${kind}.pdf`,
  kind,
  url,
});
const docs = (tender: string, contract: string) => ({
  contract: doc("contract", contract),
  tender: doc("tender", tender),
});
const input = (
  sourceDocuments: ReturnType<typeof docs>,
  extraction: unknown = null,
) => ({
  extraction: extraction as never,
  sourceDocuments,
});

describe("assertProjectDocumentsInStore", () => {
  test("documents in this deployment's own store pass", () => {
    assertProjectDocumentsInStore(
      input(docs(own("t.pdf"), own("c.pdf"))),
      STORE,
    );
  });

  test("another Vercel Blob account's file is refused, per document", () => {
    for (const [tender, contract] of [
      [STRANGER, own("c.pdf")],
      [own("t.pdf"), STRANGER],
    ]) {
      assert.throws(
        () =>
          assertProjectDocumentsInStore(input(docs(tender, contract)), STORE),
        (error) =>
          error instanceof DomainValidationError
          && /must be a file uploaded to this app/.test(error.message),
      );
    }
  });

  test("an arbitrary address is refused", () => {
    assert.throws(
      () =>
        assertProjectDocumentsInStore(
          input(docs("http://169.254.169.254/latest/meta-data", own("c.pdf"))),
          STORE,
        ),
      DomainValidationError,
    );
  });

  test("with no store id (a missing or malformed token) everything is refused", () => {
    assert.throws(
      () =>
        assertProjectDocumentsInStore(
          input(docs(own("t.pdf"), own("c.pdf"))),
          null,
        ),
      DomainValidationError,
    );
  });

  test("a URL smuggled inside the nested extraction is refused too", () => {
    // The command stores the nested payload's own sourceDocuments unchanged, so
    // own-store URLs at the top level must not launder an arbitrary one inside.
    assert.throws(
      () =>
        assertProjectDocumentsInStore(
          input(docs(own("t.pdf"), own("c.pdf")), {
            sourceDocuments: {
              contract: { url: own("c.pdf") },
              tender: { url: STRANGER },
            },
          }),
          STORE,
        ),
      DomainValidationError,
    );
    assertProjectDocumentsInStore(
      input(docs(own("t.pdf"), own("c.pdf")), {
        sourceDocuments: {
          contract: { url: own("c.pdf") },
          tender: { url: own("t.pdf") },
        },
      }),
      STORE,
    );
  });
});

describe("createProjectFromLead", () => {
  test("refuses a foreign document before reading or writing anything", async () => {
    const recorder = recordingDb({});
    await assert.rejects(
      createProjectFromLead(
        adminPrincipal(),
        {
          address: "1 Example St",
          council: "Council",
          estimatedEndDate: "2027-01-01",
          leadId: 1,
          lotSize: 400,
          projectName: "Example",
          siteManagerId: "user_sm",
          sourceDocuments: docs(STRANGER, own("c.pdf")),
          startDate: "2026-12-01",
        },
        recorder.db,
        { sourceStoreId: STORE },
      ),
      DomainValidationError,
    );
    // Nothing was read either: the check precedes the lead lookup.
    assert.deepEqual(recorder.calls, []);
  });
});
