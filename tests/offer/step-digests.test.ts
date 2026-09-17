import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOfferStepDigests,
  compactMoney,
  type OfferStepDigestInput,
} from "../../lib/offer/step-digests";
import {
  EMPTY_OFFER_IMAGES,
  OFFER_IMAGE_SLOTS,
} from "../../lib/offer/workspace-images";
import {
  INITIAL_OFFER_JOB,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceScopeItem,
} from "../../lib/offer/workspace-model";

const line = (
  id: string,
  costExGst: number,
  includedInContract: boolean,
): OfferWorkspaceCostLine => ({
  id,
  stageCode: "A",
  itemName: id,
  buildingSequenceTasks: [],
  offerTenderLineItem: "",
  tradeOrVendor: "",
  notesOrSpec: "",
  costExGst,
  includedInContract,
});

const scopeItem = (id: string): OfferWorkspaceScopeItem => ({
  id,
  category: "prime_cost",
  amountType: "fixed_amount",
  label: id,
  description: "",
  amount: 0,
  unit: "",
  variationRule: "",
  includedInOfferDocument: true,
  includedInTender: true,
});

const BASE: OfferStepDigestInput = {
  job: { ...INITIAL_OFFER_JOB, bedrooms: 5, bathrooms: 3 },
  totalAreaSqm: 838,
  lines: [line("a", 1000, true), line("b", 2000, true), line("c", 500, false)],
  directTotal: 3000,
  contractValueIncGst: 3_639_541,
  effectiveMargin: { effectiveMarkupPct: 0.2, marginStatus: "at_target" },
  allowances: [scopeItem("pc1")],
  exclusions: [scopeItem("ex1"), scopeItem("ex2")],
  images: EMPTY_OFFER_IMAGES,
  status: "pending",
  sendBlockers: [],
  phaseUnlocked: {
    "tender-gate": false,
    tender: false,
    contract: false,
    project: false,
  },
  tenderGateStatus: "unanswered",
};

const ALL_UNLOCKED = {
  "tender-gate": true,
  tender: true,
  contract: true,
  project: true,
} as const;

test("each step reports its own number, not a Complete/Incomplete chip", () => {
  const d = buildOfferStepDigests(BASE);

  assert.equal(d["job-setup"], "5 bed · 3 bath · 838 m²");
  // Only the INCLUDED lines are counted: an excluded line is not in the price.
  assert.equal(d["cost-schedule"], "2 lines · $3,000");
  assert.equal(d.pricing, "20% margin · $3.64m");
  assert.equal(d.scope, "1 allowance · 2 excluded");
  assert.equal(
    d["offer-document"],
    `0 of ${OFFER_IMAGE_SLOTS.length} images set`,
  );
});

test("an untouched offer says so rather than printing zeros", () => {
  const d = buildOfferStepDigests({
    ...BASE,
    job: INITIAL_OFFER_JOB,
    totalAreaSqm: 0,
    lines: [],
    directTotal: 0,
    contractValueIncGst: 0,
  });

  assert.equal(d["job-setup"], "Not started");
  assert.equal(d["cost-schedule"], "No lines yet");
  assert.equal(d.pricing, "Not priced");
});

test("the send row tracks status, and counts blockers only while pending", () => {
  const blocker = {
    id: "b1",
    label: "No façade",
    stepId: "offer-step-job-setup",
    severity: "block" as const,
  };

  assert.equal(buildOfferStepDigests(BASE).send, "Ready to send");
  assert.equal(
    buildOfferStepDigests({ ...BASE, sendBlockers: [blocker] }).send,
    "1 blocker",
  );
  assert.equal(
    buildOfferStepDigests({ ...BASE, sendBlockers: [blocker, blocker] }).send,
    "2 blockers",
  );
  // Once issued the blocker count is meaningless; the status is the news.
  assert.equal(
    buildOfferStepDigests({ ...BASE, status: "sent", sendBlockers: [blocker] })
      .send,
    "Sent, awaiting reply",
  );
  assert.equal(
    buildOfferStepDigests({ ...BASE, status: "offer_signed" }).send,
    "Accepted",
  );
});

test("money is shortened so a seven-figure value fits a 240px rail", () => {
  assert.equal(compactMoney(0), "$0");
  assert.equal(compactMoney(850), "$850");
  assert.equal(compactMoney(9_999), "$9,999");
  assert.equal(compactMoney(10_000), "$10k");
  assert.equal(compactMoney(2_697_000), "$2.7m");
  assert.equal(compactMoney(3_639_541), "$3.64m");
  assert.equal(compactMoney(1_000_000), "$1m");
  // The seam: anything that rounds to a thousand thousands must say "m".
  assert.equal(compactMoney(999_499), "$999k");
  assert.equal(compactMoney(999_500), "$1m");
  assert.equal(compactMoney(999_999), "$1m");
});

test("the margin digest uses the same 1dp format as the summary strip", () => {
  const d = buildOfferStepDigests({
    ...BASE,
    effectiveMargin: { effectiveMarkupPct: 0.175, marginStatus: "at_target" },
  });
  // Not "18% margin" beside a strip reading "17.5%".
  assert.equal(d.pricing, "17.5% margin · $3.64m");
});

test("a gated phase stops describing its gate once the gate is open", () => {
  const shut = buildOfferStepDigests(BASE);
  assert.equal(shut["tender-gate"], "Unlocks once the offer is agreed");

  const agreed = buildOfferStepDigests({
    ...BASE,
    status: "agreed",
    phaseUnlocked: { ...BASE.phaseUnlocked, "tender-gate": true },
  });
  // An agreed offer's own current row must not say "unlocks once agreed".
  assert.notEqual(agreed["tender-gate"], "Unlocks once the offer is agreed");
  assert.equal(agreed["tender-gate"], "Awaiting tender access");
  assert.equal(
    buildOfferStepDigests({
      ...BASE,
      status: "agreed",
      phaseUnlocked: {
        ...BASE.phaseUnlocked,
        "tender-gate": true,
        tender: true,
      },
      tenderGateStatus: "unlocked",
    })["tender-gate"],
    "Tender access granted",
  );
  // Later phases still shut still describe their gate.
  assert.equal(agreed.contract, "Unlocks when the tender is signed");
});

test("the open late phases each say where their own step stands", () => {
  // Every open row used to print the offer's status, so at contract_sent the
  // gate, Tender and Contract rows all read "Contract sent".
  const contractSent = buildOfferStepDigests({
    ...BASE,
    status: "contract_sent",
    phaseUnlocked: { ...ALL_UNLOCKED, project: false },
  });
  assert.equal(contractSent["tender-gate"], "Tender access granted");
  assert.equal(contractSent.tender, "Tender signed");
  assert.equal(contractSent.contract, "Contract sent");
  const midway = [
    contractSent["tender-gate"],
    contractSent.tender,
    contractSent.contract,
  ];
  assert.equal(new Set(midway).size, midway.length);

  const project = buildOfferStepDigests({
    ...BASE,
    status: "project",
    phaseUnlocked: ALL_UNLOCKED,
  });
  const late = [
    project["tender-gate"],
    project.tender,
    project.contract,
    project.project,
  ];
  assert.deepEqual(late, [
    "Tender access granted",
    "Tender signed",
    "Contract signed",
    "Project created",
  ]);
  assert.equal(new Set(late).size, late.length);

  assert.equal(
    buildOfferStepDigests({
      ...BASE,
      status: "contract_signed",
      phaseUnlocked: ALL_UNLOCKED,
    }).project,
    "Ready to create",
  );
});

test("the job digest prints the area without a floating-point tail", () => {
  const d = buildOfferStepDigests({ ...BASE, totalAreaSqm: 180.1 + 20.2 });
  assert.equal(d["job-setup"], "5 bed · 3 bath · 200.3 m²");
});

test("every step has a digest, so no rail row can render blank", () => {
  const d = buildOfferStepDigests(BASE);
  for (const [step, text] of Object.entries(d)) {
    assert.ok(text.length > 0, `${step} produced an empty digest`);
  }
  assert.equal(Object.keys(d).length, 10);
});

test("the scope digest says when an allowance is left off the Tender", () => {
  const d = buildOfferStepDigests({
    ...BASE,
    allowances: [
      { ...scopeItem("pc1"), includedInTender: false },
      scopeItem("pc2"),
    ],
  });
  assert.equal(d.scope, "2 allowances · 2 excluded · 1 not on Tender");
});
