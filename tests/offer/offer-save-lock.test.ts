import assert from "node:assert/strict";
import { test } from "node:test";

import { lockedSnapshotChanges } from "../../lib/offer/offer-editability";
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
  CURRENT_CALC_VERSION,
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  canonicalStoredWorkspace,
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  validatePersistedWorkspace,
  type OfferWorkspaceSnapshot,
  type PersistedOfferWorkspaceState,
} from "../../lib/offer/workspace-persistence";

// saveOfferWorkspace wrote the client's whole snapshot at every editable status.
// A tab still showing an offer as pending after another tab had sent it could
// change a cost line, and the save repriced an issued offer in place, money
// columns included. The server now refuses a save that changes a step frozen
// at the offer's stored status; these pin which steps freeze when.

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

// A row as Prisma hands it back: plain JSON.
function storedRow(snapshot: OfferWorkspaceSnapshot): unknown {
  return JSON.parse(JSON.stringify(serializeWorkspace(snapshot)));
}

// What the server compares for an incoming save: the client's snapshot after
// the save's own validation.
function incoming(snapshot: OfferWorkspaceSnapshot): PersistedOfferWorkspaceState {
  const result = validatePersistedWorkspace(storedRow(snapshot));
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.state;
}

const STORED = canonicalStoredWorkspace(storedRow(BASE));
const SAVE_STATUSES: readonly OfferWorkspaceStatus[] = [
  "pending",
  "sent",
  "agreed",
  "tender_draft",
];

const withFirstLineCost = (costExGst: number): OfferWorkspaceSnapshot => ({
  ...BASE,
  lines: BASE.lines.map((line, index) =>
    index === 0 ? { ...line, costExGst } : line,
  ),
});

test("an unchanged snapshot saves at every status the workspace saves at", () => {
  for (const status of SAVE_STATUSES) {
    assert.deepEqual(lockedSnapshotChanges(status, STORED, incoming(BASE)), [], status);
  }
});

test("a cost line change is refused once the offer is issued", () => {
  const changed = incoming(withFirstLineCost(BASE.lines[0].costExGst + 12_345));

  assert.deepEqual(lockedSnapshotChanges("pending", STORED, changed), []);
  for (const status of ["sent", "agreed", "tender_draft"] as const) {
    assert.deepEqual(
      lockedSnapshotChanges(status, STORED, changed),
      ["costLines"],
      status,
    );
  }
});

test("the offer document stays editable while sent and freezes once agreed", () => {
  const changed = incoming({
    ...BASE,
    draft: { ...BASE.draft, headline: "A revised headline" },
  });

  assert.deepEqual(lockedSnapshotChanges("sent", STORED, changed), []);
  assert.deepEqual(lockedSnapshotChanges("agreed", STORED, changed), ["draft"]);
});

test("the payment schedule and tender access stay writable until the Tender is sent", () => {
  const changed = incoming({
    ...BASE,
    paymentSchedule: BASE.paymentSchedule.map((row, index) =>
      index === 0 ? { ...row, trigger: "On signing the Tender" } : row,
    ),
    tenderGate: { ...BASE.tenderGate, needsArchitecturalPlan: false },
  });

  for (const status of ["agreed", "tender_draft"] as const) {
    assert.deepEqual(lockedSnapshotChanges(status, STORED, changed), [], status);
  }
});

test("the revision label the workspace stamps on load is not a job edit", () => {
  const relabelled = incoming({
    ...BASE,
    job: { ...BASE.job, reference: "RC-Q-2026-002", revision: "R2" },
  });
  assert.deepEqual(lockedSnapshotChanges("sent", STORED, relabelled), []);

  const areaEdit = incoming({ ...BASE, job: { ...BASE.job, groundFloorSqm: 999 } });
  assert.deepEqual(lockedSnapshotChanges("sent", STORED, areaEdit), ["job"]);
});

test("nothing is saved once the Tender is out, changed or not", () => {
  const changed = incoming({ ...BASE, paymentSchedule: [] });
  assert.deepEqual(lockedSnapshotChanges("tender_sent", STORED, changed), ["status"]);

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
    assert.deepEqual(
      lockedSnapshotChanges(status, STORED, incoming(BASE)),
      ["status"],
      status,
    );
  }
});

test("a pinned version moving is refused even though no step owns it", () => {
  const repinned = incoming({ ...BASE, calcVersion: LEGACY_CALC_VERSION });
  assert.deepEqual(lockedSnapshotChanges("sent", STORED, repinned), ["calcVersion"]);

  const restamped = incoming({ ...BASE, adminContentVersion: 4 });
  assert.deepEqual(lockedSnapshotChanges("agreed", STORED, restamped), [
    "adminContentVersion",
  ]);
});

test("nothing saved yet means nothing to protect", () => {
  const changed = incoming(withFirstLineCost(1));
  assert.deepEqual(lockedSnapshotChanges("sent", null, changed), []);
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
  const shuffled = reorder(STORED) as PersistedOfferWorkspaceState;
  assert.notEqual(Object.keys(shuffled)[0], Object.keys(STORED)[0]);

  for (const status of SAVE_STATUSES) {
    assert.deepEqual(lockedSnapshotChanges(status, shuffled, incoming(BASE)), [], status);
  }
});

test("a legacy row reads back as no change when a tab that opened it saves", () => {
  // The shape of an offer saved before calcVersion, admin versioning, the
  // tender gate and the stored HBCF contract value: pre-v6 schedule entries, a
  // bare-string image, and no derived pricing keys.
  const legacy = storedRow(BASE) as Record<string, unknown>;
  delete legacy.calcVersion;
  delete legacy.adminContentVersion;
  delete legacy.tenderGate;
  legacy.schemaVersion = 5;
  legacy.images = { hero: BLOB_URL };
  const pricing = { ...(legacy.pricingSettings as Record<string, number>) };
  delete pricing.hbcfTotalContractValue;
  delete pricing.royalConstructionOverheadPct;
  delete pricing.loadingChargePercentage;
  legacy.pricingSettings = pricing;

  // The tab hydrates from the loader's snapshot and saves it back unedited,
  // including the formula the workspace attaches to admin cost lines, which is
  // never part of the stored state.
  const opened = deserializeWorkspace(parseWorkspaceState(legacy));
  const saved = incoming({
    ...opened,
    lines: opened.lines.map((line, index) =>
      index === 0 ? { ...line, formula: "TOTAL_AREA * 10" } : line,
    ),
  });

  const stored = canonicalStoredWorkspace(legacy);
  for (const status of SAVE_STATUSES) {
    assert.deepEqual(lockedSnapshotChanges(status, stored, saved), [], status);
  }
});

test("a save naming an image outside Blob storage is refused, not written", () => {
  const persisted = storedRow({
    ...BASE,
    images: { hero: { url: "http://169.254.169.254/latest/meta-data/", source: "upload" } },
  });
  const result = validatePersistedWorkspace(persisted);
  assert.equal(result.ok, false);
});

test("a save that would write a row the read parse refuses is invalid", () => {
  const persisted = storedRow(BASE) as Record<string, unknown>;
  persisted.costLines = "not a list";
  assert.equal(validatePersistedWorkspace(persisted).ok, false);
});
