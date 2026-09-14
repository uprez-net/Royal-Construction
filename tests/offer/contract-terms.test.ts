import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  describeTenderPriceMismatch,
  resolveContractPaymentSource,
  withTenderPaymentTerms,
} from "../../lib/offer/contract-payment-source";
import {
  contractPreviewTerms,
  contractTermsInput,
  resolveContractTerms,
} from "../../lib/offer/contract-terms";
import { formatPercent } from "../../lib/offer/format";
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
import {
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import { individualOwner, snapshotOf } from "./tender-fixtures";

// The Contract step previewed the workspace's payment schedule while the send
// filled the BC4 from the signed Tender, so the estimator reviewed one schedule
// and the customer received another. The preview now reads the terms the send
// resolves until the BC4 goes out, and the tab values it went out with after.

const SIGNED_SCHEDULE: readonly OfferPaymentScheduleRow[] = [
  { id: "deposit", stageName: "Deposit", percentOfContract: 0.025, trigger: "On signing" },
  { id: "slab", stageName: "Slab", percentOfContract: 0.175, trigger: "Slab poured" },
  { id: "frame", stageName: "Frame", percentOfContract: 0.25, trigger: "Frame up" },
  { id: "lockup", stageName: "Lock-up", percentOfContract: 0.25, trigger: "Locked up" },
  { id: "fitout", stageName: "Fit-out", percentOfContract: 0.2, trigger: "Fit-out done" },
  { id: "handover", stageName: "Handover", percentOfContract: 0.1, trigger: "Keys" },
];

// One more stage than the BC4 template has slots for.
const EIGHT_STAGES: readonly OfferPaymentScheduleRow[] = [
  ...SIGNED_SCHEDULE,
  { id: "pc", stageName: "Practical completion", percentOfContract: 0.05, trigger: "PC" },
  { id: "final", stageName: "Final", percentOfContract: 0.05, trigger: "Defects" },
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

// A stored state as Prisma hands it back: plain JSON.
const stored = (snapshot: OfferWorkspaceSnapshot): unknown =>
  roundTrip(serializeWorkspace(snapshot));

// What sendTenderForSignature writes to Tender.documentData.
const stampedTender = (schedule: readonly OfferPaymentScheduleRow[]) =>
  roundTrip(
    withTenderPaymentTerms(
      buildProposalInput({ ...agreedSnapshot(), paymentSchedule: schedule }),
    ),
  );

const TENDER_ROWS = {
  "tender-terms": () => stampedTender(SIGNED_SCHEDULE),
  // A Tender sent before the terms were stamped: the render input only.
  "tender-document": () =>
    roundTrip(
      buildProposalInput({ ...agreedSnapshot(), paymentSchedule: SIGNED_SCHEDULE }),
    ),
  "agreed-snapshot": () => null,
} as const;

// Tenders no Contract can go out on.
const REFUSED_TENDERS = {
  "more stages than the BC4 has": () => stampedTender(EIGHT_STAGES),
  "a Tender that printed another price": () => {
    const tender = stampedTender(SIGNED_SCHEDULE) as {
      paymentTerms: { contractValueIncGst: number };
    };
    tender.paymentTerms.contractValueIncGst += 1234.57;
    return tender;
  },
} as const;

// The BC4 values and refusals as sendContractForSignature computed them before
// it shared the resolver, written out independently so the shared one cannot
// drift from them.
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
    refusal:
      describeTenderPriceMismatch({
        tenderContractValueIncGst: payment.tenderContractValueIncGst,
        agreedContractValueIncGst: contractValue,
      }) ??
      (payment.paymentSchedule.length > 7
        ? `The contract template supports up to 7 payment stages, but this schedule has ${payment.paymentSchedule.length}. Consolidate the payment schedule before sending the Contract.`
        : null),
  };
}

const ALL_TENDERS = { ...TENDER_ROWS, ...REFUSED_TENDERS };

for (const [name, tenderRow] of Object.entries(ALL_TENDERS)) {
  test(`the preview terms are the BC4 values and refusal the send has (${name})`, () => {
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
        refusal: terms.refusal,
      },
      sendPathValues(tenderRow(), snapshot),
    );
    assert.equal(terms.refusal === null, name in TENDER_ROWS);
  });
}

test("the preview names the refusal the send returns", () => {
  const agreed = agreedSnapshot();
  const refusal = (tender: unknown) =>
    resolveContractTerms({ tenderDocumentData: tender, agreedSnapshot: agreed }).terms
      .refusal;

  assert.match(
    refusal(REFUSED_TENDERS["more stages than the BC4 has"]()) ?? "",
    /up to 7 payment stages, but this schedule has 8/,
  );
  assert.match(
    refusal(REFUSED_TENDERS["a Tender that printed another price"]()) ?? "",
    /The signed Tender's contract price is .* The Contract can't be sent\./,
  );
});

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
    "refusal",
    "source",
  ]);
});

test("the send and the Contract step read one copy of the offer: agreedSnapshot, else workspaceState", () => {
  const tender = TENDER_ROWS["tender-terms"]();
  const edited = { ...agreedSnapshot(), paymentSchedule: SIGNED_SCHEDULE };
  const stages = (input: ReturnType<typeof contractTermsInput>) =>
    input?.agreedSnapshot.paymentSchedule.map((row) => row.stageName);

  const agreed = contractTermsInput({
    agreedSnapshot: stored(agreedSnapshot()),
    workspaceState: stored(edited),
    tender: { documentData: tender },
  });
  assert.deepEqual(stages(agreed), INITIAL_PAYMENT_SCHEDULE.map((row) => row.stageName));
  assert.deepEqual(agreed?.tenderDocumentData, tender);

  const unagreed = contractTermsInput({
    agreedSnapshot: null,
    workspaceState: stored(edited),
    tender: null,
  });
  assert.deepEqual(stages(unagreed), SIGNED_SCHEDULE.map((row) => row.stageName));
  assert.equal(unagreed?.tenderDocumentData, null);

  assert.equal(
    contractTermsInput({ agreedSnapshot: null, workspaceState: null, tender: null }),
    null,
  );
});

// ─── A sent Contract shows what its BC4 carried ───

// Contract.documentData as the send stored it before contracts took their terms
// from the signed Tender: agreedSnapshot's stages with whole-number percents (a
// 2.5% deposit printed as 3%), the exclusion bullets alone, and no
// paymentScheduleSource.
const LEGACY_CONTRACT = {
  templateId: "template",
  tabs: {
    contractPrice: "$650,000.00",
    paymentSchedule:
      "(1) Deposit 3% $16,250.00  |  (2) Foundation 15% $97,500.00  |  (3) Frame 20% $130,000.00",
    depositAmount: "$16,250.00",
    exclusionsList: "Landscaping\nFencing",
  },
};

function offerRow(contractDocumentData: unknown) {
  return {
    agreedSnapshot: stored(agreedSnapshot()),
    workspaceState: null,
    tender: { documentData: TENDER_ROWS["tender-terms"]() },
    contract: { documentData: contractDocumentData },
  };
}

test("REGRESSION: a Contract sent before Tender-sourced terms shows what its BC4 carried", () => {
  const row = offerRow(LEGACY_CONTRACT);

  assert.deepEqual(contractPreviewTerms({ status: "CONTRACT_SIGNED", row }), {
    source: "sent-contract",
    scheduleSource: null,
    paymentSchedule: [
      { stageName: "Deposit", percent: "3%", amount: "$16,250.00" },
      { stageName: "Foundation", percent: "15%", amount: "$97,500.00" },
      { stageName: "Frame", percent: "20%", amount: "$130,000.00" },
    ],
    depositAmount: "$16,250.00",
    exclusions: ["Landscaping", "Fencing"],
  });
  // Resolving again lists the signed Tender's stages and the ticked Scope
  // exclusion, neither of which that BC4 carried.
  const resolved = contractPreviewTerms({ status: "CONTRACT_DRAFT", row });
  assert.ok(resolved !== null && resolved.source !== "sent-contract");
  assert.ok(resolved.exclusions.includes(agreedSnapshot().exclusions[0].label));
});

test("a Contract sent now reads back the terms the preview showed before the send", () => {
  const before = contractPreviewTerms({ status: "CONTRACT_DRAFT", row: offerRow({}) });
  assert.ok(before !== null && before.source !== "sent-contract");
  // What sendContractForSignature stores, through a JSON column.
  const sentDocument = roundTrip({
    templateId: "template",
    tabs: {
      paymentSchedule: before.paymentScheduleLine,
      depositAmount: before.depositAmount,
      exclusionsList: before.exclusions.join("\n"),
    },
    paymentScheduleSource: before.source,
  });

  assert.deepEqual(
    contractPreviewTerms({ status: "CONTRACT_SIGNED", row: offerRow(sentDocument) }),
    {
      source: "sent-contract",
      scheduleSource: "tender-terms",
      paymentSchedule: before.paymentSchedule.map((stage) => ({
        stageName: stage.stageName,
        percent: formatPercent(stage.percentOfContract),
        amount: formatContractMoney(stage.amount),
      })),
      depositAmount: before.depositAmount,
      exclusions: before.exclusions,
    },
  );
});

test("no terms before the Tender is signed, resolved until the BC4 is sent, read back after", () => {
  const row = offerRow(LEGACY_CONTRACT);
  const source = (status: string, from = row) =>
    contractPreviewTerms({ status, row: from })?.source ?? null;

  for (const status of ["PENDING", "AGREED", "TENDER_SENT"]) {
    assert.equal(source(status), null, status);
  }
  for (const status of ["TENDER_SIGNED", "CONTRACT_DRAFT"]) {
    assert.equal(source(status), "tender-terms", status);
  }
  for (const status of ["CONTRACT_SENT", "CONTRACT_SIGNED", "CONTRACT_DECLINED", "PROJECT"]) {
    assert.equal(source(status), "sent-contract", status);
  }
  // A development sign leaves the Contract row as generated, with no tabs.
  assert.equal(source("CONTRACT_SIGNED", offerRow({})), "tender-terms");
});

// No pure seam reaches the send, the loader or the panel, so their wiring is
// pinned in source.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("the contract send reads the offer and refuses through the shared terms", () => {
  const send = read("lib/data/offer-contract-sign.ts");

  assert.match(send, /const termsInput = contractTermsInput\(offer\);/);
  assert.match(send, /resolveContractTerms\(termsInput\)/);
  assert.match(
    send,
    /if \(contractTerms\.refusal\) \{\s*return \{ ok: false, error: contractTerms\.refusal \};/,
  );
  // The state choice and the refusals live in the shared module only.
  assert.doesNotMatch(send, /agreedSnapshot \?\?/);
  assert.doesNotMatch(
    send,
    /describeTenderPriceMismatch\(|CONTRACT_STAGE_SLOTS|resolveContractPaymentSource\(|tenderExclusionLines\(/,
  );
  assert.match(send, /locked\("paymentSchedule", contractTerms\.paymentScheduleLine\)/);
  assert.match(send, /locked\("depositAmount", contractTerms\.depositAmount\)/);
  assert.match(send, /const exclusions = contractTerms\.exclusions;/);
});

test("the loader reads the send's rows and the sent Contract through the shared helper", () => {
  const loader = read("lib/data/offer-workspace.ts");
  const load = loader.slice(
    loader.indexOf("async function loadContractTerms("),
    loader.indexOf("async function attachContractTerms("),
  );

  for (const column of [
    /agreedSnapshot: true,/,
    /workspaceState: true,/,
    /tender: \{ select: \{ documentData: true \} \},/,
    /contract: \{ select: \{ documentData: true \} \},/,
  ]) {
    assert.match(load, column);
  }
  assert.match(load, /contractPreviewTerms\(\{ status, row: offer \}\)/);
  assert.doesNotMatch(load, /agreedSnapshot \?\?|resolveContractTerms\(/);
  assert.match(loader, /contractTerms\?: ContractPreviewTerms \| null;/);
  assert.match(loader, /return attachContractTerms\(/);
  // Only a caller holding no terms asks; the signing ticks do not re-read them.
  assert.match(loader, /input\.needsContractTerms === true\s*\?\s*loadContractTerms\(/);
  // The Tender's documentData is read on the server and not returned.
  assert.doesNotMatch(loader, /contractTerms:[^\n]*documentData/);
});

test("a status reached without a load asks for the terms once", () => {
  const workspace = read("components/offers/new-workflow/new-offer-workspace.tsx");

  assert.match(workspace, /contractTerms !== null \|\|\s*!hasContractTerms\(status\)/);
  assert.match(workspace, /pollOfferSigningStatus\(\{ offerId, needsContractTerms: true \}\)/);
  assert.equal(workspace.match(/needsContractTerms/g)?.length, 1);
  assert.match(workspace, /\}, \[leadId, status, contractTerms\]\);/);
});

test("the Contract preview shows the sent tabs, the refusal and each legacy source", () => {
  const panel = read("components/offers/new-workflow/offer-workspace-contract.tsx");
  const preview = panel.slice(panel.indexOf("function ContractScheduleToSend("));

  assert.match(preview, /contractTerms\.source === "sent-contract"/);
  assert.match(preview, /<SentContractSchedule terms=\{contractTerms\} \/>/);
  assert.match(preview, /showRefusal=\{state === "draft"\}/);
  assert.match(preview, /showRefusal && terms\.refusal/);
  assert.match(preview, /terms\.paymentSchedule\.map\(/);
  assert.match(preview, /terms\.depositAmount/);
  assert.match(preview, /contractTerms\.exclusions/);
  assert.match(preview, /source === "agreed-snapshot"/);
  assert.match(preview, /scheduleSource === null/);
  assert.doesNotMatch(preview, /Reload the page/);
  assert.doesNotMatch(preview, /paymentSchedule\.map\(\(row\) =>/);
});
