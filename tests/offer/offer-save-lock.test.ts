import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { lockedSnapshotChanges } from "../../lib/offer/offer-editability";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferWorkspaceStatus,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import {
  reverseHbcfTotalContractValue,
  withDerivedHbcfPremium,
} from "../../lib/offer/workspace-pricing";
import {
  CURRENT_CALC_VERSION,
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  deserializeWorkspace,
  parseWorkspaceState,
  planWorkspaceSave,
  serializeWorkspace,
  settledWorkspace,
  validatePersistedWorkspace,
  type OfferWorkspaceSnapshot,
  type PersistedOfferWorkspaceState,
} from "../../lib/offer/workspace-persistence";

// saveOfferWorkspace wrote the client's whole snapshot at every editable status.
// A tab still showing an offer as pending after another tab had sent it could
// change a cost line, and the save repriced an issued offer in place, money
// columns included. The server now refuses a save that changes a step frozen
// at the offer's stored status; these pin which steps freeze when.
//
// The first version of that lock compared the tab's snapshot with the stored
// row re-hydrated, then wrote the tab's copy. A tab holding a legacy or
// workbook HBCF premium had its second edit refused and thrown away, and a
// legacy offer's price moved a cent on its first save. These also pin that a
// same-tab edit goes through and an issued offer's price stays put.

const BLOB_URL =
  "https://udafiztdzg1cn8u2.public.blob.vercel-storage.com/offer/hero.png";

const BASE: OfferWorkspaceSnapshot = {
  job: { ...INITIAL_OFFER_JOB, reference: "RC-Q-2026-001", revision: "R1" },
  lines: INITIAL_COST_LINES,
  allowances: INITIAL_ALLOWANCES,
  exclusions: INITIAL_EXCLUSIONS,
  draft: INITIAL_OFFER_DRAFT,
  areaCalculator: INITIAL_AREA_CALCULATOR,
  workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
  paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
  rateCardProduct: "DOUBLE_STOREY",
  rateCardTier: "MID",
  overrideReason: "",
  selectedPriceInput: "",
  standardPriceInput: "",
  priceAdjustmentLabel: "",
  images: { hero: { url: BLOB_URL, source: "upload" } },
  tenderGate: INITIAL_TENDER_GATE,
  adminContentVersion: 3,
  calcVersion: CURRENT_CALC_VERSION,
};

const ISSUED_SAVE_STATUSES = ["sent", "agreed", "tender_draft"] as const;
const SAVE_STATUSES: readonly OfferWorkspaceStatus[] = [
  "pending",
  ...ISSUED_SAVE_STATUSES,
];

// A row as Prisma hands it back: plain JSON.
function row(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const STORED = row(serializeWorkspace(BASE));

// What saveOfferWorkspace does with a tab's snapshot: validate it, then plan
// the write against the parsed stored row (null when never saved).
function save(
  status: OfferWorkspaceStatus,
  storedRow: unknown,
  snapshot: OfferWorkspaceSnapshot,
) {
  const incoming = validatePersistedWorkspace(row(serializeWorkspace(snapshot)));
  assert.ok(incoming.ok, incoming.ok ? "" : incoming.error);
  return planWorkspaceSave(
    status,
    storedRow === null ? null : parseWorkspaceState(storedRow),
    incoming.state,
  );
}

// The frozen slices a save was refused for; empty when it went through.
function refused(
  status: OfferWorkspaceStatus,
  storedRow: unknown,
  snapshot: OfferWorkspaceSnapshot,
): readonly string[] {
  const plan = save(status, storedRow, snapshot);
  return plan.ok ? [] : plan.changes;
}

// The row a save that went through leaves behind.
function written(
  status: OfferWorkspaceStatus,
  storedRow: unknown,
  snapshot: OfferWorkspaceSnapshot,
): unknown {
  const plan = save(status, storedRow, snapshot);
  assert.ok(plan.ok, plan.ok ? "" : `refused: ${plan.changes.join(", ")}`);
  return row(plan.state);
}

// A stored row as the loader hands it to the workspace.
function open(storedRow: unknown): OfferWorkspaceSnapshot {
  return deserializeWorkspace(parseWorkspaceState(storedRow));
}

// The contract value a stored row prints and fills the money columns with.
function printedPrice(storedRow: unknown): number {
  return buildProposalInput(open(storedRow)).customerPrice
    .selectedContractValueIncGst;
}

// An edit each issued status still accepts: the offer document while sent, the
// payment schedule once agreed.
function allowedEdit(
  status: (typeof ISSUED_SAVE_STATUSES)[number],
  snapshot: OfferWorkspaceSnapshot,
  text: string,
): OfferWorkspaceSnapshot {
  return status === "sent"
    ? { ...snapshot, draft: { ...snapshot.draft, headline: text } }
    : {
        ...snapshot,
        paymentSchedule: snapshot.paymentSchedule.map((scheduleRow, index) =>
          index === 0 ? { ...scheduleRow, trigger: text } : scheduleRow,
        ),
      };
}

const withFirstLineCost = (costExGst: number): OfferWorkspaceSnapshot => ({
  ...BASE,
  lines: BASE.lines.map((line, index) =>
    index === 0 ? { ...line, costExGst } : line,
  ),
});

test("an unchanged snapshot saves at every status the workspace saves at", () => {
  for (const status of SAVE_STATUSES) {
    assert.deepEqual(refused(status, STORED, BASE), [], status);
  }
});

test("a cost line change is refused once the offer is issued", () => {
  const changed = withFirstLineCost(BASE.lines[0].costExGst + 12_345);

  assert.deepEqual(refused("pending", STORED, changed), []);
  for (const status of ISSUED_SAVE_STATUSES) {
    assert.deepEqual(refused(status, STORED, changed), ["costLines"], status);
  }
});

test("the offer document stays editable while sent and freezes once agreed", () => {
  const changed = {
    ...BASE,
    draft: { ...BASE.draft, headline: "A revised headline" },
  };

  assert.deepEqual(refused("sent", STORED, changed), []);
  assert.deepEqual(refused("agreed", STORED, changed), ["draft"]);
});

test("the payment schedule and tender access stay writable until the Tender is sent", () => {
  const changed = {
    ...allowedEdit("agreed", BASE, "On signing the Tender"),
    tenderGate: { ...BASE.tenderGate, needsArchitecturalPlan: false },
  };

  for (const status of ["agreed", "tender_draft"] as const) {
    assert.deepEqual(refused(status, STORED, changed), [], status);
    const saved = written(status, STORED, changed) as PersistedOfferWorkspaceState;
    assert.equal(saved.paymentSchedule[0].trigger, "On signing the Tender");
    assert.equal(saved.tenderGate.needsArchitecturalPlan, false);
  }
});

test("the revision label the workspace stamps on load is not a job edit", () => {
  const relabelled = {
    ...BASE,
    job: { ...BASE.job, reference: "RC-Q-2026-002", revision: "R2" },
  };
  assert.deepEqual(refused("sent", STORED, relabelled), []);
  const saved = written("sent", STORED, relabelled) as PersistedOfferWorkspaceState;
  assert.equal(saved.job.revision, "R2");

  const areaEdit = { ...BASE, job: { ...BASE.job, groundFloorSqm: 999 } };
  assert.deepEqual(refused("sent", STORED, areaEdit), ["job"]);
});

test("nothing is saved once the Tender is out, changed or not", () => {
  assert.deepEqual(
    refused("tender_sent", STORED, { ...BASE, paymentSchedule: [] }),
    ["status"],
  );

  for (const status of [
    "offer_sent",
    "offer_signed",
    "offer_declined",
    "tender_sent",
    "tender_signed",
    "tender_declined",
    "contract_draft",
    "contract_sent",
    "contract_signed",
    "contract_declined",
    "project",
    "rejected",
    "superseded",
  ] as const) {
    assert.deepEqual(refused(status, STORED, BASE), ["status"], status);
  }
});

test("a pinned version moving is refused even though no step owns it", () => {
  assert.deepEqual(
    refused("sent", STORED, { ...BASE, calcVersion: LEGACY_CALC_VERSION }),
    ["calcVersion"],
  );
  assert.deepEqual(refused("agreed", STORED, { ...BASE, adminContentVersion: 4 }), [
    "adminContentVersion",
  ]);
});

test("nothing saved yet means nothing to protect", () => {
  const changed = withFirstLineCost(1);
  const saved = written("sent", null, changed) as PersistedOfferWorkspaceState;
  assert.equal(saved.costLines[0].costExGstCents, 100);
});

test("a stored row with its keys in another order is not a change", () => {
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(reorder);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([key, inner]) => [key, reorder(inner)]),
      );
    }
    return value;
  };
  const stored = settledWorkspace(STORED);
  const shuffled = reorder(stored) as PersistedOfferWorkspaceState;
  assert.notEqual(Object.keys(shuffled)[0], Object.keys(stored)[0]);

  for (const status of SAVE_STATUSES) {
    assert.deepEqual(
      lockedSnapshotChanges(status, shuffled, settledWorkspace(STORED)),
      [],
      status,
    );
  }
});

// An offer saved before calcVersion, admin versioning, the tender gate and the
// stored HBCF contract value: pre-v6 schedule entries, a bare-string image, and
// a dollar premium with nothing to derive it from.
function legacyRow(): Record<string, unknown> {
  const legacy = row(serializeWorkspace(BASE)) as Record<string, unknown>;
  delete legacy.calcVersion;
  delete legacy.adminContentVersion;
  delete legacy.tenderGate;
  legacy.schemaVersion = 5;
  legacy.images = { hero: BLOB_URL };
  const pricing = { ...(legacy.pricingSettings as Record<string, number>) };
  delete pricing.hbcfTotalContractValue;
  delete pricing.royalConstructionOverheadPct;
  delete pricing.loadingChargePercentage;
  pricing.homeWarrantyHbcfFixed = 5000;
  legacy.pricingSettings = pricing;
  return legacy;
}

test("a tab keeps saving edits to an issued legacy offer, and its price does not move", () => {
  const legacy = legacyRow();
  // The tab's hydrated premium re-derives a cent off the stored one, which is
  // what the lock used to read as a pricing edit.
  assert.notEqual(settledWorkspace(legacy).pricingSettings.homeWarrantyHbcfFixed, 5000);

  for (const status of ISSUED_SAVE_STATUSES) {
    // The tab opens the offer, carrying the formula the workspace attaches to
    // admin cost lines, which is never part of the stored state.
    const opened = open(legacy);
    const tab = {
      ...opened,
      lines: opened.lines.map((line, index) =>
        index === 0 ? { ...line, formula: "TOTAL_AREA * 10" } : line,
      ),
    };

    const first = allowedEdit(status, tab, "first edit");
    const afterFirst = written(status, legacy, first);
    // Same tab, no reload in between.
    const second = allowedEdit(status, first, "second edit");
    assert.deepEqual(refused(status, afterFirst, second), [], status);
    const afterSecond = written(status, afterFirst, second);

    assert.equal(printedPrice(afterFirst), printedPrice(legacy), status);
    assert.equal(printedPrice(afterSecond), printedPrice(legacy), status);
    assert.deepEqual(
      (afterSecond as PersistedOfferWorkspaceState).pricingSettings,
      parseWorkspaceState(legacy).pricingSettings,
      status,
    );
  }
});

test("a tab that imported a workbook premium can edit the offer after sending it", () => {
  // A workbook import with no loading charge keeps the workbook's dollar premium
  // and reverse-fills the contract value, rather than re-deriving a cent off.
  const premium = 1053.48;
  const tab: OfferWorkspaceSnapshot = {
    ...BASE,
    workspacePricingSettings: {
      ...DEFAULT_WORKSPACE_PRICING_SETTINGS,
      homeWarrantyHbcfFixed: premium,
      hbcfTotalContractValue: reverseHbcfTotalContractValue(
        premium,
        DEFAULT_WORKSPACE_PRICING_SETTINGS.hbcfRate,
      ),
      loadingChargePercentage: 0,
    },
  };
  const savedAtPending = written("pending", STORED, tab);
  assert.notEqual(
    settledWorkspace(savedAtPending).pricingSettings.homeWarrantyHbcfFixed,
    premium,
  );

  // Sending does not reload the tab, so it edits from the same state.
  for (const status of ISSUED_SAVE_STATUSES) {
    const edited = allowedEdit(status, tab, "after sending");
    assert.deepEqual(refused(status, savedAtPending, edited), [], status);
    assert.equal(
      printedPrice(written(status, savedAtPending, edited)),
      printedPrice(savedAtPending),
      status,
    );
  }
});

test("a pending tab that took the admin loading charge can edit the offer after sending it", () => {
  const stored = row(
    serializeWorkspace({
      ...BASE,
      workspacePricingSettings: withDerivedHbcfPremium({
        ...DEFAULT_WORKSPACE_PRICING_SETTINGS,
        hbcfTotalContractValue: 800_000,
        loadingChargePercentage: 0,
      }),
    }),
  );
  // Opening a pending offer swaps in the admin loading charge without
  // re-deriving the premium, and autosave stores that.
  const opened = open(stored);
  const tab = {
    ...opened,
    workspacePricingSettings: {
      ...opened.workspacePricingSettings,
      loadingChargePercentage: 5,
    },
  };
  const savedAtPending = written("pending", stored, tab);
  assert.notEqual(
    settledWorkspace(savedAtPending).pricingSettings.homeWarrantyHbcfFixed,
    tab.workspacePricingSettings.homeWarrantyHbcfFixed,
  );

  for (const status of ISSUED_SAVE_STATUSES) {
    assert.deepEqual(
      refused(status, savedAtPending, allowedEdit(status, tab, "after sending")),
      [],
      status,
    );
  }
});

test("a stale tab's HBCF contract value change is still refused on a legacy offer", () => {
  const legacy = legacyRow();
  const opened = open(legacy);
  const repriced = {
    ...opened,
    workspacePricingSettings: withDerivedHbcfPremium({
      ...opened.workspacePricingSettings,
      hbcfTotalContractValue: 900_000,
    }),
  };

  for (const status of ISSUED_SAVE_STATUSES) {
    assert.deepEqual(refused(status, legacy, repriced), ["pricingSettings"], status);
  }
});

test("a save naming an image outside Blob storage is refused, not written", () => {
  const persisted = row(
    serializeWorkspace({
      ...BASE,
      images: {
        hero: { url: "http://169.254.169.254/latest/meta-data/", source: "upload" },
      },
    }),
  );
  const result = validatePersistedWorkspace(persisted);
  assert.equal(result.ok, false);
});

test("a save that would write a row the read parse refuses is invalid", () => {
  const persisted = row(serializeWorkspace(BASE)) as Record<string, unknown>;
  persisted.costLines = "not a list";
  assert.equal(validatePersistedWorkspace(persisted).ok, false);
});

test("the save action writes the plan and prices the money columns from it", () => {
  // saveOfferWorkspace is "use server" and loads Prisma, so no test can call it.
  // Writing the tab's own copy instead of the plan is what moved a legacy
  // offer's price, and every test above would stay green.
  const text = readFileSync(
    join(process.cwd(), "lib/data/offer-workspace.ts"),
    "utf8",
  );
  const start = text.indexOf("async function saveOfferWorkspace(");
  assert.ok(start >= 0, "saveOfferWorkspace not found");
  const body = text.slice(start, text.indexOf("\n}\n", start));

  assert.match(body, /planWorkspaceSave\(/);
  assert.match(body, /workspaceState:\s*saved\b/);
  assert.match(body, /buildProposalInput\([^)]*\bsavedSnapshot\b/);
  assert.doesNotMatch(body, /input\.snapshot\.workspacePricingSettings/);
});
