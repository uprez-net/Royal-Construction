import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeLegacyContractScheduleDrift,
  describeTenderPriceMismatch,
  resolveContractPaymentSource,
  withTenderPaymentTerms,
} from "../../lib/offer/contract-payment-source";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { paymentScheduleLine } from "../../lib/offer/project-handoff-commercials";
import {
  INITIAL_PAYMENT_SCHEDULE,
  type OfferPaymentScheduleRow,
} from "../../lib/offer/workspace-payment-schedule";
import type { OfferWorkspaceSnapshot } from "../../lib/offer/workspace-persistence";
import { individualOwner, snapshotOf } from "./tender-fixtures";

// The BC4 contract and the project took the payment schedule and deposit from
// agreedSnapshot, not from the Tender the customer signed. The Tender renders
// from the workspace at send time, so a schedule that differed reached the
// contract and the project while the signed Tender said otherwise.

// The schedule the customer signed on the Tender: a half-percent deposit.
const SIGNED_SCHEDULE: readonly OfferPaymentScheduleRow[] = [
  {
    id: "deposit",
    stageName: "Deposit",
    percentOfContract: 0.025,
    trigger: "On signing",
  },
  {
    id: "slab",
    stageName: "Slab",
    percentOfContract: 0.175,
    trigger: "Slab poured",
  },
  {
    id: "frame",
    stageName: "Frame",
    percentOfContract: 0.25,
    trigger: "Frame up",
  },
  {
    id: "lockup",
    stageName: "Lock-up",
    percentOfContract: 0.25,
    trigger: "Locked up",
  },
  {
    id: "fitout",
    stageName: "Fit-out",
    percentOfContract: 0.2,
    trigger: "Fit-out done",
  },
  {
    id: "handover",
    stageName: "Handover",
    percentOfContract: 0.1,
    trigger: "Keys",
  },
];

function tenderSnapshot(): OfferWorkspaceSnapshot {
  return {
    ...snapshotOf([individualOwner(1)]),
    paymentSchedule: SIGNED_SCHEDULE,
  };
}

// Exactly what sendTenderForSignature writes to Tender.documentData.
function sentTenderDocumentData(snapshot: OfferWorkspaceSnapshot): unknown {
  return JSON.parse(
    JSON.stringify(withTenderPaymentTerms(buildProposalInput(snapshot))),
  );
}

// Tender.documentData as sends before the stamp wrote it: the render input only.
function legacyTenderDocumentData(snapshot: OfferWorkspaceSnapshot): unknown {
  return JSON.parse(JSON.stringify(buildProposalInput(snapshot)));
}

test("the signed Tender's schedule wins over a drifted agreed snapshot", () => {
  const resolved = resolveContractPaymentSource({
    tenderDocumentData: sentTenderDocumentData(tenderSnapshot()),
    agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  });

  assert.equal(resolved.source, "tender-terms");
  assert.deepEqual(resolved.paymentSchedule, SIGNED_SCHEDULE);
  assert.equal(resolved.deposit?.stageName, "Deposit");
  assert.equal(resolved.deposit?.percentOfContract, 0.025);
  assert.equal(
    resolved.tenderContractValueIncGst,
    buildProposalInput(tenderSnapshot()).customerPrice
      .selectedContractValueIncGst,
  );
});

test("a Tender sent before the stamp still uses the schedule it printed", () => {
  const resolved = resolveContractPaymentSource({
    tenderDocumentData: legacyTenderDocumentData(tenderSnapshot()),
    agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  });

  assert.equal(resolved.source, "tender-document");
  assert.deepEqual(resolved.paymentSchedule, SIGNED_SCHEDULE);
  assert.equal(resolved.deposit?.percentOfContract, 0.025);
  assert.notEqual(resolved.tenderContractValueIncGst, null);
});

test("a legacy Tender without a stored schedule falls back to the agreed snapshot", () => {
  const unusable: unknown[] = [
    null,
    {},
    { paymentSchedule: [] },
    // One row unreadable: not the schedule that was signed.
    { paymentSchedule: [SIGNED_SCHEDULE[0], { stageName: "Slab" }] },
    { paymentTerms: { paymentSchedule: "nope" } },
  ];
  for (const tenderDocumentData of unusable) {
    const resolved = resolveContractPaymentSource({
      tenderDocumentData,
      agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    });
    assert.equal(
      resolved.source,
      "agreed-snapshot",
      `${JSON.stringify(tenderDocumentData)} was read as a Tender schedule`,
    );
    assert.deepEqual(resolved.paymentSchedule, INITIAL_PAYMENT_SCHEDULE);
    assert.equal(resolved.deposit?.percentOfContract, 0.05);
    assert.equal(resolved.tenderContractValueIncGst, null);
  }
});

test("half-percent stages reach the BC4 line exactly", () => {
  const resolved = resolveContractPaymentSource({
    tenderDocumentData: sentTenderDocumentData(tenderSnapshot()),
    agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  });

  assert.deepEqual(
    resolved.paymentSchedule.map((row) => row.percentOfContract),
    [0.025, 0.175, 0.25, 0.25, 0.2, 0.1],
  );
  assert.equal(
    paymentScheduleLine(resolved.paymentSchedule.slice(0, 2), 650_000),
    "(1) Deposit 2.5% $16,250.00  |  (2) Slab 17.5% $113,750.00",
  );
});

test("a price mismatch is refused, naming both figures as the contract prints them", () => {
  const refusal = describeTenderPriceMismatch({
    tenderContractValueIncGst: 651_234.57,
    agreedContractValueIncGst: 650_000,
  });

  assert.ok(refusal);
  assert.match(refusal, /\$651,234\.57/);
  assert.match(refusal, /\$650,000\.00/);
});

test("a one-cent difference is still a mismatch", () => {
  assert.ok(
    describeTenderPriceMismatch({
      tenderContractValueIncGst: 651_234.57,
      agreedContractValueIncGst: 651_234.56,
    }),
  );
});

test("the same price in cents is not a mismatch, whatever the float path", () => {
  assert.equal(
    describeTenderPriceMismatch({
      tenderContractValueIncGst: 651_234.57,
      agreedContractValueIncGst: 65_123_457 / 100 + 1e-9,
    }),
    null,
  );
  // Nothing readable on the Tender: nothing to compare.
  assert.equal(
    describeTenderPriceMismatch({
      tenderContractValueIncGst: null,
      agreedContractValueIncGst: 650_000,
    }),
    null,
  );
});

// ─── A Contract sent before the schedule came from the Tender ───

// Contract.documentData as the send wrote it before paymentScheduleSource: the
// BC4 was filled from agreedSnapshot's schedule.
const LEGACY_CONTRACT_DATA = {
  templateId: "bc4",
  tabs: { paymentSchedule: "(1) Deposit 5% $32,500.00" },
};

test("the handoff warns when a pre-change Contract printed a different schedule", () => {
  const resolved = resolveContractPaymentSource({
    tenderDocumentData: sentTenderDocumentData(tenderSnapshot()),
    agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  });
  const warning = describeLegacyContractScheduleDrift({
    contractDocumentData: LEGACY_CONTRACT_DATA,
    agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    resolved,
    contractValueIncGst: 650_000,
  });

  assert.ok(warning);
  assert.match(warning, /Contract: \(1\) \S.* 5% \$32,500\.00/);
  assert.match(warning, /Signed Tender: \(1\) Deposit 2\.5% \$16,250\.00/);
});

test("no handoff warning when the Contract records its source or printed the same schedule", () => {
  const resolved = resolveContractPaymentSource({
    tenderDocumentData: sentTenderDocumentData(tenderSnapshot()),
    agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  });
  const base = {
    agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    resolved,
    contractValueIncGst: 650_000,
  };

  assert.equal(
    describeLegacyContractScheduleDrift({
      ...base,
      contractDocumentData: {
        ...LEGACY_CONTRACT_DATA,
        paymentScheduleSource: "tender-terms",
      },
    }),
    null,
  );
  assert.equal(
    describeLegacyContractScheduleDrift({
      ...base,
      contractDocumentData: LEGACY_CONTRACT_DATA,
      // Stored with float noise, but the same stages.
      agreedPaymentSchedule: SIGNED_SCHEDULE.map((row) => ({
        ...row,
        percentOfContract: row.percentOfContract + 1e-12,
      })),
    }),
    null,
  );
  // Nothing on the Tender: the project took the agreed snapshot, as the Contract did.
  assert.equal(
    describeLegacyContractScheduleDrift({
      ...base,
      contractDocumentData: LEGACY_CONTRACT_DATA,
      resolved: resolveContractPaymentSource({
        tenderDocumentData: null,
        agreedPaymentSchedule: INITIAL_PAYMENT_SCHEDULE,
      }),
    }),
    null,
  );
});
