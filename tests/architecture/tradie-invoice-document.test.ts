import assert from "node:assert/strict";

import { describe, test } from "vitest";

import { DomainValidationError } from "@/lib/domain/errors";
import { readTradieInvoiceDocument } from "@/lib/domain/tradies/invoice-document";

import { adminPrincipal, recordingDb } from "./domain-harness";

// An uploaded tradie invoice is fetched and OCR'd by the server, so its URL
// must be one this deployment uploaded, into this project's folder.

const project = {
  id: "p_1",
  location: "12 Smith St",
  name: "Smith Residence",
  siteManagerId: null,
};
const STORE = "abc123";
const inFolder = `https://${STORE}.public.blob.vercel-storage.com/projects/p_1/tradie-invoices/inv-x1.pdf`;

function read(url: string, contentType = "application/pdf") {
  let called = false;
  const run = readTradieInvoiceDocument(
    adminPrincipal(),
    {
      contentType,
      document: { name: "inv.pdf", url },
      projectId: "p_1",
      storeId: STORE,
    },
    recordingDb({ "project.findUnique": project }).db,
    async () => {
      called = true;
      return {
        dueDate: "15/11/2026",
        invoiceNumber: " INV-7 ",
        issuedDate: "2026-11-01",
        subTotal: null,
        supplierName: "Ace Carpentry",
        total: 1100,
        totalTax: 100,
      };
    },
  );
  return { called: () => called, run };
}

describe("reading an uploaded tradie invoice", () => {
  test("another store, or another project's folder, is refused before any read", async () => {
    for (const url of [
      `https://evil.public.blob.vercel-storage.com/projects/p_1/tradie-invoices/a.pdf`,
      `https://${STORE}.public.blob.vercel-storage.com/projects/p_2/tradie-invoices/a.pdf`,
      "http://169.254.169.254/latest/meta-data",
      // A malformed escape, and an encoded ".." out of the project's folder.
      `https://${STORE}.public.blob.vercel-storage.com/projects/p_1/tradie-invoices/%E0%A4%A.pdf`,
      `https://${STORE}.public.blob.vercel-storage.com/projects/p_1/tradie-invoices/%2e%2e/%2e%2e/p_2/a.pdf`,
    ]) {
      const attempt = read(url);
      await assert.rejects(() => attempt.run, DomainValidationError);
      assert.equal(attempt.called(), false, url);
    }
  });

  test("a Word document is refused", async () => {
    const attempt = read(
      inFolder,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    await assert.rejects(() => attempt.run, DomainValidationError);
    assert.equal(attempt.called(), false);
  });

  test("what was read is tidied: a malformed date dropped, a missing subtotal derived", async () => {
    const fields = await read(inFolder).run;
    assert.equal(fields.invoiceNumber, "INV-7");
    assert.equal(fields.issuedDate, "2026-11-01");
    assert.equal(fields.dueDate, null);
    assert.equal(fields.subTotal, 1000);
    assert.equal(fields.totalTax, 100);
  });
});
