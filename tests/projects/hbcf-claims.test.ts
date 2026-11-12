import assert from "node:assert/strict";

import { test } from "vitest";

import {
  appendHbcfClaimDocuments,
  hbcfClaimDate,
  hbcfClaimDateConflicts,
  hbcfClaimTotal,
  normalizeClaimAmount,
  readHbcfClaimDocuments,
} from "@/lib/domain/insurance/hbcf-claims";
import type { HbcfClaimDocument } from "@/types/project-flow";

// Issue #423: several HBCF claim documents on one project, and one total.

const doc = (
  fileId: string,
  patch: Partial<HbcfClaimDocument> = {},
): HbcfClaimDocument => ({
  amountConfirmed: true,
  certificateNumber: null,
  claimAmount: null,
  coverStartDate: null,
  fileId,
  fileName: `${fileId}.pdf`,
  url: `https://blob.example/${fileId}.pdf`,
  ...patch,
});

test("the total is the sum of every confirmed claim amount", () => {
  const { total, counted, excluded } = hbcfClaimTotal([
    doc("claim-1", { claimAmount: 2500 }),
    doc("claim-2", { claimAmount: 3000 }),
    doc("claim-3", { claimAmount: 1500 }),
  ]);
  assert.equal(total, 7000);
  assert.deepEqual(counted, ["claim-1", "claim-2", "claim-3"]);
  assert.equal(excluded.size, 0);
});

test("cents add up exactly rather than drifting in floating point", () => {
  const { total } = hbcfClaimTotal([
    doc("a", { claimAmount: 0.1 }),
    doc("b", { claimAmount: 0.2 }),
  ]);
  assert.equal(total, 0.3);
});

test("an unconfirmed or missing amount is shown but not counted", () => {
  const { total, excluded } = hbcfClaimTotal([
    doc("read-off-pdf", { amountConfirmed: false, claimAmount: 9000 }),
    doc("no-amount"),
    doc("confirmed", { claimAmount: 1200 }),
  ]);
  assert.equal(total, 1200);
  assert.equal(excluded.get("read-off-pdf"), "unconfirmed");
  assert.equal(excluded.get("no-amount"), "missing");
});

test("an invalid amount never reaches the total", () => {
  for (const bad of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      hbcfClaimTotal([doc("x", { claimAmount: bad })]).total,
      0,
      String(bad),
    );
  }
  assert.equal(normalizeClaimAmount("2500.556"), 2500.56);
  assert.equal(normalizeClaimAmount(""), null);
  assert.equal(normalizeClaimAmount("abc"), null);
});

test("the same claim is counted once, whether as the same file or the same certificate", () => {
  const { total, counted, excluded } = hbcfClaimTotal([
    doc("first", { certificateNumber: "HBC-123 456", claimAmount: 4000 }),
    doc("first", { claimAmount: 4000 }),
    doc("rescan", { certificateNumber: "hbc-123456", claimAmount: 4000 }),
    doc("other", { certificateNumber: "HBC-999", claimAmount: 1000 }),
  ]);
  assert.equal(total, 5000);
  assert.deepEqual(counted, ["first", "other"]);
  assert.equal(excluded.get("rescan"), "duplicate-certificate");
});

test("a project from before multiple documents reads its one certificate as a list, uncounted", () => {
  const documents = readHbcfClaimDocuments({
    hbcfInsuranceDocument: {
      fileId: "legacy",
      fileName: "certificate.pdf",
      kind: "hbcfInsurance",
      url: "https://blob.example/legacy.pdf",
    },
    hbcfInsuranceNumber: " HBC-1 ",
  });
  assert.deepEqual(documents, [
    {
      amountConfirmed: false,
      certificateNumber: "HBC-1",
      claimAmount: null,
      coverStartDate: null,
      fileId: "legacy",
      fileName: "certificate.pdf",
      url: "https://blob.example/legacy.pdf",
    },
  ]);
  assert.equal(hbcfClaimTotal(documents).total, 0);
  assert.deepEqual(readHbcfClaimDocuments({}), []);
});

test("adding documents keeps every one already there and skips a re-upload", () => {
  const existing = [doc("a", { claimAmount: 100 })];
  const next = appendHbcfClaimDocuments(existing, [
    doc("a", { claimAmount: 999 }),
    doc("b"),
    doc("b"),
  ]);
  assert.deepEqual(
    next.map((d) => [d.fileId, d.claimAmount]),
    [
      ["a", 100],
      ["b", null],
    ],
  );
});

test("documents that disagree with the claim date are flagged, never applied", () => {
  const documents = [
    doc("a", { coverStartDate: "2026-03-01" }),
    doc("b", { coverStartDate: "2026-03-04" }),
    doc("c"),
  ];
  const withClaim = hbcfClaimDateConflicts(documents, "2026-03-01");
  assert.deepEqual(
    withClaim.conflicting.map((d) => d.fileId),
    ["b"],
  );

  // No claim date yet: two different dates on the documents is a question.
  const noClaim = hbcfClaimDateConflicts(documents, null);
  assert.deepEqual(noClaim.documentDates, ["2026-03-01", "2026-03-04"]);
  assert.deepEqual(
    noClaim.conflicting.map((d) => d.fileId),
    ["a", "b"],
  );

  // One date everywhere: nothing to ask.
  assert.deepEqual(
    hbcfClaimDateConflicts([documents[0], documents[2]], null).conflicting,
    [],
  );
});

test("the claim date is only a real calendar day", () => {
  assert.equal(
    hbcfClaimDate({ insuranceClaimStartDate: "2026-11-12" }),
    "2026-11-12",
  );
  assert.equal(hbcfClaimDate({ insuranceClaimStartDate: "2026-02-30" }), null);
  assert.equal(hbcfClaimDate({ insuranceClaimStartDate: "" }), null);
  assert.equal(hbcfClaimDate(null), null);
});
