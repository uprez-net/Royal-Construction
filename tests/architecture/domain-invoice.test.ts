import assert from "node:assert/strict";
import { Prisma, InvoiceStatus } from "@prisma/client";
import { test } from "node:test";

import { syncInvoiceFromExternal } from "../../lib/domain/invoices/sync";
import { createStageInvoice } from "../../lib/domain/invoices/stage-creation";
import { recordingDb } from "./domain-harness";

const fields = {
  invoiceNumber: "INV-1",
  reference: "Stage claim",
  status: InvoiceStatus.PAID,
  currencyCode: "AUD",
  subTotal: new Prisma.Decimal(100),
  totalTax: new Prisma.Decimal(10),
  total: new Prisma.Decimal(110),
  amountDue: new Prisma.Decimal(0),
  amountPaid: new Prisma.Decimal(110),
  amountCredited: new Prisma.Decimal(0),
  issuedDate: new Date("2026-01-01"),
  dueDate: new Date("2026-01-15"),
  fullyPaidOnDate: new Date("2026-01-10"),
  xeroUpdatedAt: new Date("2026-01-11"),
};

test("invoice sync ignores an external invoice that is not ours", async () => {
  let fetched = false;
  const result = await syncInvoiceFromExternal(
    "xero_other",
    recordingDb({ "invoice.findUnique": null }).db,
    async () => {
      fetched = true;
      return { fields };
    },
  );
  assert.deepEqual(result, { kind: "unknown" });
  assert.equal(fetched, false);
});

test("invoice sync refuses a stale status and timestamp without writing", async () => {
  const recorder = recordingDb({
    "invoice.findUnique": {
      id: "invoice_1",
      pdfUrl: "https://blob.test/invoice.pdf",
      projectId: "project_1",
      status: InvoiceStatus.PAID,
      xeroUpdatedAt: new Date("2026-01-12"),
    },
  });
  const result = await syncInvoiceFromExternal(
    "xero_1",
    recorder.db,
    async () => ({ fields: { ...fields, xeroUpdatedAt: new Date("2026-01-11") } }),
  );
  assert.deepEqual(result, { kind: "stale" });
  assert.deepEqual(recorder.writes(), []);
});

test("invoice sync writes the mirror and archives a missing PDF through a port", async () => {
  const recorder = recordingDb({
    "invoice.findUnique": {
      id: "invoice_1",
      pdfUrl: null,
      projectId: "project_1",
      status: InvoiceStatus.AUTHORISED,
      xeroUpdatedAt: new Date("2026-01-01"),
    },
    "invoice.update": {},
  });
  const result = await syncInvoiceFromExternal(
    "xero_1",
    recorder.db,
    async () => ({
      archivePdf: async () => "https://blob.test/invoice.pdf",
      fields,
    }),
  );
  assert.deepEqual(result, { invoiceId: "invoice_1", kind: "updated" });
  assert.equal(recorder.writes().length, 2);
  assert.deepEqual(
    (recorder.writes()[1].args as { data: unknown }).data,
    { pdfUrl: "https://blob.test/invoice.pdf" },
  );
});

test("stage invoice creation resolves the agreed claim before issuing externally", async () => {
  const recorder = recordingDb({
    "project.findUnique": {
      customer: {
        address: "1 Builder Street",
        email: "owner@example.com",
        id: "customer_1",
        name: "Owner",
        phone: "0400000000",
        xeroContactId: "contact_1",
      },
      id: "project_1",
      name: "House project",
      requirements: null,
      totalBudget: 100_000,
    },
    "invoice.create": {},
  });
  let issuedClaim = 0;
  const result = await createStageInvoice(
    {
      issuedDate: new Date("2026-01-01"),
      projectId: "project_1",
      projectStage: "Deposit",
      stageLabel: "Deposit",
    },
    recorder.db,
    async ({ claim }) => {
      issuedClaim = claim;
      return { fields, xeroInvoiceId: "xero_stage_1" };
    },
  );

  assert.ok(result);
  assert.equal(issuedClaim, 5_000);
  assert.deepEqual(recorder.operations(), ["project.findUnique", "invoice.create"]);
});
