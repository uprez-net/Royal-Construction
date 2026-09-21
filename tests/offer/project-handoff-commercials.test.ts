import assert from "node:assert/strict";
import { test } from "node:test";

import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import {
  buildHandoffCommercials,
  describeMissingExecutedDocuments,
  findDepositRow,
  paymentScheduleLine,
  tenderExclusionLines,
  resolveSignedTenderExclusions,
} from "../../lib/offer/project-handoff-commercials";
import { INITIAL_EXCLUSIONS } from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import { buildOfferPrintTemplateData } from "../../lib/offer/workspace-print-template";
import { individualOwner, snapshotOf } from "./tender-fixtures";

// The BC4 contract send and the project handoff each derived their own figures
// from the offer, and neither matched the signed Tender:
// - the handoff recorded GST as a whole-dollar value / 11 and rounded every
//   stage to whole dollars, while the contract printed cents;
// - the contract printed stage percentages with toFixed(0), so a 2.5% deposit
//   read "3%" beside the 2.5% amount;
// - both took exclusions from draft.exclusionBullets alone, dropping every
//   ticked Scope exclusion the Tender printed;
// - the handoff told the estimator to "complete signing" when the documents
//   were signed and only the executed PDF's archive had failed (issue #90).

// ─── GST and stage amounts ───

test("handoff GST is the offer's own split and the deposit is exact to the cent", () => {
  const commercials = buildHandoffCommercials({
    contractValueIncGst: 651_234.57,
    gstRate: 0.1,
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    deposit: findDepositRow(INITIAL_PAYMENT_SCHEDULE),
  });

  assert.equal(commercials.gstAmount, 59_203.14);
  assert.equal(commercials.depositValue, 32_561.73);
  assert.equal(commercials.paymentStages[0].amount, 32_561.73);
  assert.equal(commercials.paymentStages[0].percentage, 5);
});

test("stage percentages carry no float noise", () => {
  const commercials = buildHandoffCommercials({
    contractValueIncGst: 100_000,
    gstRate: 0.1,
    paymentSchedule: [
      { id: "a", stageName: "Frame", percentOfContract: 0.07, trigger: "" },
      { id: "b", stageName: "Deposit", percentOfContract: 0.025, trigger: "" },
    ],
    deposit: null,
  });

  assert.deepEqual(
    commercials.paymentStages.map((stage) => stage.percentage),
    [7, 2.5],
  );
  assert.equal(commercials.depositValue, null);
});

test("the deposit is the stage named deposit, else the first stage", () => {
  const rows = [
    { id: "a", stageName: "Slab", percentOfContract: 0.1, trigger: "" },
    {
      id: "b",
      stageName: "Initial deposit",
      percentOfContract: 0.05,
      trigger: "",
    },
  ];
  assert.equal(findDepositRow(rows)?.id, "b");
  assert.equal(findDepositRow(rows.slice(0, 1))?.id, "a");
  assert.equal(findDepositRow([]), null);
});

// ─── BC4 payment schedule line ───

test("a 2.5% deposit prints exactly on the BC4 payment schedule", () => {
  assert.equal(
    paymentScheduleLine(
      [
        {
          id: "d",
          stageName: "Deposit",
          percentOfContract: 0.025,
          trigger: "",
        },
      ],
      650_000,
    ),
    "(1) Deposit 2.5% $16,250.00",
  );
});

test("every stage is numbered in the one field", () => {
  assert.equal(
    paymentScheduleLine(INITIAL_PAYMENT_SCHEDULE.slice(0, 2), 100_000),
    "(1) Deposit 5% $5,000.00  |  (2) Foundation 15% $15,000.00",
  );
});

// ─── Exclusions ───

test("contract and project exclusions are the Tender's rows, Scope items included", () => {
  const base = snapshotOf([individualOwner(1)]);
  const snapshot = {
    ...base,
    draft: {
      ...base.draft,
      exclusionBullets: [
        "Swimming pool or spa",
        "Pool, spa and water features",
      ],
    },
    exclusions: [
      // Same label as a bullet: printed once.
      { ...INITIAL_EXCLUSIONS[0], includedInOfferDocument: true },
      {
        ...INITIAL_EXCLUSIONS[1],
        id: "scope-only",
        label: "Retaining walls",
        includedInOfferDocument: true,
      },
      {
        ...INITIAL_EXCLUSIONS[1],
        id: "unticked",
        label: "Driveway beyond 10 metres",
        includedInOfferDocument: false,
      },
    ],
  };

  const lines = tenderExclusionLines(snapshot);

  assert.deepEqual(lines, [
    "Swimming pool or spa",
    "Pool, spa and water features",
    "Retaining walls",
  ]);
  assert.deepEqual(
    lines,
    buildOfferPrintTemplateData(buildProposalInput(snapshot)).exclusionRows.map(
      (row) => row.label,
    ),
  );
});

// ─── Missing executed documents ───

test("a signed document whose PDF is missing asks for a retry, not a signature", () => {
  const message = describeMissingExecutedDocuments([
    { kind: "tender", signed: true },
  ]);
  assert.ok(message);
  assert.match(message, /Tender is signed/);
  assert.match(message, /Try again in a moment/);
  assert.doesNotMatch(message, /Complete signing/);
});

test("a document DocuSign has not completed asks for the signature", () => {
  const message = describeMissingExecutedDocuments([
    { kind: "contract", signed: false },
  ]);
  assert.ok(message);
  assert.match(message, /No executed Contract/);
  assert.match(message, /Complete signing via DocuSign/);
  assert.doesNotMatch(message, /could not be fetched/);
});

test("both cases are named when both apply, and nothing missing is no message", () => {
  const message = describeMissingExecutedDocuments([
    { kind: "tender", signed: true },
    { kind: "contract", signed: false },
  ]);
  assert.match(message ?? "", /Tender is signed/);
  assert.match(message ?? "", /No executed Contract/);
  assert.equal(describeMissingExecutedDocuments([]), null);
});

// The Contract and the project must carry what the SIGNED Tender printed. The
// workspace can still be written after the offer is agreed, so rebuilding the
// lines from the snapshot could put a line on the BC4 the customer never signed.
test("exclusions come from the signed Tender's stored document", () => {
  const resolved = resolveSignedTenderExclusions({
    tenderDocumentData: {
      draft: { exclusionBullets: ["Landscaping (not in scope)"] },
      exclusions: [],
    },
    snapshot: {
      job: { hasGrannyHome: false, grannyFlatSqm: 0 },
      draft: { exclusionBullets: ["Edited after the Tender went out"] },
      exclusions: [],
    } as never,
  });
  assert.deepEqual(resolved.lines, ["Landscaping (not in scope)"]);
  assert.equal(resolved.source, "tender-document");
});

test("a Tender row with nothing readable falls back to the snapshot", () => {
  for (const documentData of [null, {}, { draft: {} }, "not an object"]) {
    const resolved = resolveSignedTenderExclusions({
      tenderDocumentData: documentData,
      snapshot: {
        job: { hasGrannyHome: false, grannyFlatSqm: 0 },
        draft: { exclusionBullets: ["Landscaping (not in scope)"] },
        exclusions: [],
      } as never,
    });
    assert.deepEqual(
      resolved.lines,
      ["Landscaping (not in scope)"],
      `for ${JSON.stringify(documentData)}`,
    );
    assert.equal(resolved.source, "agreed-snapshot");
  }
});
