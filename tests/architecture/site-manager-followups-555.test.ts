// Issue #555: the tender and contract PDFs carry the full contract price. A
// site manager must not get them as ordinary project files either, whether
// they were linked from the requirements, tagged, or only named like that.

import { test } from "vitest";
import assert from "node:assert/strict";

import { hideDetailProjectFinancials } from "@/lib/domain/projects/financial-redaction";

const requirements = {
  commercialsAndClaims: { totalContractSum: "250000" },
  sourceDocuments: {
    contract: {
      fileId: "f_contract_linked",
      fileName: "scan.pdf",
      kind: "contract",
      url: "https://x",
    },
    tender: {
      fileId: "f_tender_linked",
      fileName: "scan2.pdf",
      kind: "tender",
      url: "https://y",
    },
  },
};

function detail(overrides: Record<string, unknown>) {
  return hideDetailProjectFinancials({
    activityLogs: [],
    certifierEngagement: null,
    customer: {},
    documents: [],
    files: [],
    invoices: [],
    materials: [],
    milestones: [],
    requirements,
    siteUpdates: [],
    tradieSchedules: [],
    variations: [],
    ...overrides,
  } as never);
}

test("a tender or contract linked from the requirements is dropped by file id, whatever it is called", () => {
  const hidden = detail({
    documents: [
      {
        fileId: "f_contract_linked",
        key: "f_contract_linked",
        name: "scan.pdf",
        source: "project",
        tags: [],
      },
      {
        fileId: "f_plans",
        key: "f_plans",
        name: "plans.pdf",
        source: "project",
        tags: [],
      },
    ],
    files: [
      { filename: "scan.pdf", id: "f_contract_linked", leadId: null, tags: [] },
      { filename: "scan2.pdf", id: "f_tender_linked", leadId: null, tags: [] },
      { filename: "plans.pdf", id: "f_plans", leadId: null, tags: [] },
    ],
  });
  assert.deepEqual(
    hidden.documents.map((d) => d.key),
    ["f_plans"],
  );
  assert.deepEqual(
    hidden.files.map((f) => f.id),
    ["f_plans"],
  );
});

test("a file the Overview repointed by URL is dropped even when its file id is stale", () => {
  const hidden = detail({
    requirements: {
      commercialsAndClaims: { totalContractSum: "250000" },
      sourceDocuments: {
        contract: {
          fileId: "f_stale",
          fileName: "scan.pdf",
          kind: "contract",
          url: "https://blob/x.pdf",
        },
      },
    },
    documents: [
      {
        fileId: "f_new",
        key: "f_new",
        name: "scan.pdf",
        source: "project",
        tags: [],
        url: "https://blob/x.pdf",
      },
    ],
    files: [
      {
        filename: "scan.pdf",
        id: "f_new",
        leadId: null,
        tags: [],
        url: "https://blob/x.pdf",
      },
    ],
  });
  assert.deepEqual(hidden.documents, []);
  assert.deepEqual(hidden.files, []);
});

test("a file tagged Tender or Contract is dropped even when it is not linked", () => {
  const hidden = detail({
    documents: [
      {
        fileId: "f_t",
        key: "f_t",
        name: "Signed.pdf",
        source: "project",
        tags: ["Tender"],
      },
      {
        fileId: "f_c",
        key: "f_c",
        name: "Signed2.pdf",
        source: "project",
        tags: ["contract"],
      },
    ],
    files: [
      { filename: "Signed.pdf", id: "f_t", leadId: null, tags: ["Tender"] },
      { filename: "Signed2.pdf", id: "f_c", leadId: null, tags: ["contract"] },
    ],
  });
  assert.deepEqual(hidden.documents, []);
  assert.deepEqual(hidden.files, []);
});

test("a file named like a tender or contract is dropped by the Documents tab's filename rule", () => {
  const hidden = detail({
    documents: [
      {
        fileId: "f_n",
        key: "f_n",
        name: "Tender - Smith.pdf",
        source: "project",
        tags: [],
      },
      {
        fileId: "f_k",
        key: "f_k",
        name: "Contract_v2.pdf",
        source: "milestone",
        tags: [],
      },
      {
        fileId: "f_ok",
        key: "f_ok",
        name: "Slab photo.jpg",
        source: "milestone",
        tags: [],
      },
    ],
    files: [
      { filename: "Tender - Smith.pdf", id: "f_n", leadId: null, tags: [] },
      { filename: "Slab photo.jpg", id: "f_ok", leadId: null, tags: [] },
    ],
  });
  assert.deepEqual(
    hidden.documents.map((d) => d.key),
    ["f_ok"],
  );
  assert.deepEqual(
    hidden.files.map((f) => f.id),
    ["f_ok"],
  );
});

test("tradie invoices are dropped, and customer invoices are never in the documents", () => {
  const hidden = detail({
    documents: [
      {
        fileId: null,
        key: "invoice:1",
        name: "Invoice 12",
        source: "tradie-invoice",
        tags: [],
      },
      {
        fileId: null,
        key: "tradie-invoice-inbox:2",
        name: "Quote.pdf",
        source: "tradie-invoice",
        tags: [],
      },
    ],
    invoices: [{ id: "inv_claim", total: "50000" }],
  });
  assert.deepEqual(hidden.documents, []);
  assert.deepEqual(hidden.invoices, []);
});
