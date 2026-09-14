import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  resolveContractPaymentSource,
  withTenderPaymentTerms,
} from "../../lib/offer/contract-payment-source";
import { resolveContractTerms } from "../../lib/offer/contract-terms";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import {
  formatContractMoney,
  paymentScheduleLine,
  stageAmount,
  tenderExclusionLines,
} from "../../lib/offer/project-handoff-commercials";
import {
  INITIAL_PAYMENT_SCHEDULE,
  type OfferPaymentScheduleRow,
} from "../../lib/offer/workspace-payment-schedule";
import type { OfferWorkspaceSnapshot } from "../../lib/offer/workspace-persistence";
import { individualOwner, snapshotOf } from "./tender-fixtures";

// The Contract step previewed the workspace's payment schedule while the send
// filled the BC4 from the signed Tender, so the estimator reviewed one schedule
// and the customer received another. The preview now reads the terms the send
// resolves.

const SIGNED_SCHEDULE: readonly OfferPaymentScheduleRow[] = [
  { id: "deposit", stageName: "Deposit", percentOfContract: 0.025, trigger: "On signing" },
  { id: "slab", stageName: "Slab", percentOfContract: 0.175, trigger: "Slab poured" },
  { id: "frame", stageName: "Frame", percentOfContract: 0.25, trigger: "Frame up" },
  { id: "lockup", stageName: "Lock-up", percentOfContract: 0.25, trigger: "Locked up" },
  { id: "fitout", stageName: "Fit-out", percentOfContract: 0.2, trigger: "Fit-out done" },
  { id: "handover", stageName: "Handover", percentOfContract: 0.1, trigger: "Keys" },
];

// The agreed snapshot keeps the default schedule and ticks a Scope exclusion
// beside the estimator's bullets.
function agreedSnapshot(): OfferWorkspaceSnapshot {
  const base = snapshotOf([individualOwner(1)]);
  return {
    ...base,
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    exclusions: base.exclusions.map((item, index) => ({
      ...item,
      includedInOfferDocument: index === 0,
    })),
  };
}

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const TENDER_ROWS = {
  // What sendTenderForSignature writes to Tender.documentData.
  "tender-terms": () =>
    roundTrip(
      withTenderPaymentTerms(
        buildProposalInput({ ...agreedSnapshot(), paymentSchedule: SIGNED_SCHEDULE }),
      ),
    ),
  // A Tender sent before the terms were stamped: the render input only.
  "tender-document": () =>
    roundTrip(
      buildProposalInput({ ...agreedSnapshot(), paymentSchedule: SIGNED_SCHEDULE }),
    ),
  "agreed-snapshot": () => null,
} as const;

// The BC4 values as sendContractForSignature computed them before it shared the
// resolver, written out independently so the shared one cannot drift from them.
function sendPathValues(tenderDocumentData: unknown, snapshot: OfferWorkspaceSnapshot) {
  const contractValue =
    buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst;
  const payment = resolveContractPaymentSource({
    tenderDocumentData,
    agreedPaymentSchedule: snapshot.paymentSchedule,
  });
  return {
    source: payment.source,
    contractValueIncGst: contractValue,
    paymentScheduleLine: paymentScheduleLine(
      payment.paymentSchedule.slice(0, 7),
      contractValue,
    ),
    depositAmount: payment.deposit
      ? formatContractMoney(stageAmount(contractValue, payment.deposit.percentOfContract))
      : "",
    exclusions: tenderExclusionLines(snapshot),
  };
}

for (const [source, tenderRow] of Object.entries(TENDER_ROWS)) {
  test(`the preview terms are the BC4 values the send fills (${source})`, () => {
    const snapshot = agreedSnapshot();
    const { terms } = resolveContractTerms({
      tenderDocumentData: tenderRow(),
      agreedSnapshot: snapshot,
    });

    assert.deepEqual(
      {
        source: terms.source,
        contractValueIncGst: terms.contractValueIncGst,
        paymentScheduleLine: terms.paymentScheduleLine,
        depositAmount: terms.depositAmount,
        exclusions: terms.exclusions,
      },
      sendPathValues(tenderRow(), snapshot),
    );
    assert.equal(terms.source, source);
  });
}

test("REGRESSION: the preview shows the signed Tender's schedule, not the agreed snapshot's", () => {
  const { terms } = resolveContractTerms({
    tenderDocumentData: TENDER_ROWS["tender-terms"](),
    agreedSnapshot: agreedSnapshot(),
  });

  assert.deepEqual(
    terms.paymentSchedule.map((row) => [row.stageName, row.percentOfContract]),
    SIGNED_SCHEDULE.map((row) => [row.stageName, row.percentOfContract]),
  );
  assert.equal(terms.deposit?.percentOfContract, 0.025);
  // Every row carries the cent-rounded amount the schedule line prints.
  for (const row of terms.paymentSchedule) {
    assert.equal(row.amount, stageAmount(terms.contractValueIncGst, row.percentOfContract));
    assert.ok(terms.paymentScheduleLine.includes(formatContractMoney(row.amount)));
  }
  assert.ok(terms.exclusions.includes(agreedSnapshot().exclusions[0].label));
});

test("the terms are small plain data that survive a Server Action round trip", () => {
  const { terms } = resolveContractTerms({
    tenderDocumentData: TENDER_ROWS["tender-terms"](),
    agreedSnapshot: agreedSnapshot(),
  });

  assert.deepEqual(roundTrip(terms), terms);
  assert.deepEqual(Object.keys(terms).sort(), [
    "contractValueIncGst",
    "deposit",
    "depositAmount",
    "exclusions",
    "paymentSchedule",
    "paymentScheduleLine",
    "source",
  ]);
});

// No pure seam reaches the send, the loader or the panel, so their wiring is
// pinned in source.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("the contract send fills the BC4 from the shared terms", () => {
  const send = read("lib/data/offer-contract-sign.ts");

  assert.match(send, /resolveContractTerms\(\{/);
  assert.doesNotMatch(send, /resolveContractPaymentSource\(/);
  assert.doesNotMatch(send, /tenderExclusionLines\(/);
  assert.match(send, /locked\("paymentSchedule", contractTerms\.paymentScheduleLine\)/);
  assert.match(send, /locked\("depositAmount", contractTerms\.depositAmount\)/);
  assert.match(send, /const exclusions = contractTerms\.exclusions;/);
});

test("the workspace loader and poll hand the Contract step the resolved terms", () => {
  const loader = read("lib/data/offer-workspace.ts");

  assert.match(loader, /resolveContractTerms\(\{/);
  assert.match(loader, /contractTerms\?: ContractTerms \| null;/);
  assert.match(loader, /return attachContractTerms\(/);
  // The Tender's documentData is read on the server and not returned.
  assert.doesNotMatch(loader, /contractTerms:[^\n]*documentData/);
});

test("the Contract preview renders the resolved terms and flags the legacy source", () => {
  const panel = read("components/offers/new-workflow/offer-workspace-contract.tsx");
  const preview = panel.slice(panel.indexOf("function ContractPreview("));

  assert.match(preview, /contractTerms\.paymentSchedule\.map\(/);
  assert.match(preview, /contractTerms\.depositAmount/);
  assert.match(preview, /contractTerms\.exclusions/);
  assert.match(preview, /source === "agreed-snapshot"/);
  assert.doesNotMatch(preview, /paymentSchedule\.map\(\(row\) =>/);
});
