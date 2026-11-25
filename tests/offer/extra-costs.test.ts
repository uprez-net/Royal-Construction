import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  EXTRA_COST_LINE_IDS,
  INITIAL_EXTRA_COSTS,
  collectExtraCostIssues,
  describePileCalculation,
  extraCostLines,
  pricePiles,
  priceFixedExtra,
  reapplyExtraCostAdminRates,
  resolveExtraCostAdminRates,
  setFixedExtraIncluded,
  setPileType,
  setPilesIncluded,
  staleExtraCostRates,
  withExtraCostLines,
  type OfferExtraCosts,
  type OfferPilesConfig,
} from "@/lib/offer/extra-costs";
import { DEFAULT_RATE_CONSTANTS } from "@/lib/offer/formula-variables";
import { buildInitialOfferWorkspaceSnapshot } from "@/lib/offer/initial-workspace";
import { calculateDirectTotal } from "@/lib/offer/workspace-pricing";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { lockedSnapshotChanges } from "@/lib/offer/offer-editability";
import { collectOfferSendBlockers } from "@/lib/offer/offer-readiness";
import {
  applyAdminPrefillToSnapshot,
  type AdminOfferPrefill,
} from "@/lib/offer/admin-offer-prefill";

const ADMIN = resolveExtraCostAdminRates({});

const SCREW_10: OfferPilesConfig = {
  included: true,
  type: "screw",
  quantity: 10,
  lengthPerPileM: 0,
  rate: 200,
};

const BORED_10_X_8: OfferPilesConfig = {
  included: true,
  type: "bored",
  quantity: 10,
  lengthPerPileM: 8,
  rate: 80,
};

function snapshotWith(extraCosts: OfferExtraCosts): OfferWorkspaceSnapshot {
  const base = buildInitialOfferWorkspaceSnapshot(
    undefined,
    new Date("2026-11-12T00:00:00Z"),
  );
  return { ...base, extraCosts };
}

describe("admin prices", () => {
  test("start at the confirmed initial values", () => {
    assert.deepEqual(ADMIN, {
      pumpHire: 2500,
      benching: 2000,
      screwPileRate: 200,
      boredPileRatePerM: 80,
    });
    assert.equal(DEFAULT_RATE_CONSTANTS.PUMP_HIRE, 2500);
    assert.equal(DEFAULT_RATE_CONSTANTS.BENCHING, 2000);
    assert.equal(DEFAULT_RATE_CONSTANTS.SCREW_PILE_RATE, 200);
    assert.equal(DEFAULT_RATE_CONSTANTS.BORED_PILE_RATE_PER_M, 80);
  });

  test("an admin override reaches a newly selected item", () => {
    const rates = resolveExtraCostAdminRates({ PUMP_HIRE: 2750 });
    const pumpHire = setFixedExtraIncluded(
      INITIAL_EXTRA_COSTS.pumpHire,
      true,
      rates.pumpHire,
    );
    assert.deepEqual(priceFixedExtra(pumpHire, "Pump hire"), {
      amount: 2750,
      issue: null,
    });
  });
});

describe("pump hire and benching", () => {
  test("a selected item is one times the applied price", () => {
    assert.equal(
      priceFixedExtra({ included: true, rate: 2500 }, "Pump hire").amount,
      2500,
    );
    assert.equal(
      priceFixedExtra({ included: true, rate: 2000 }, "Benching").amount,
      2000,
    );
  });

  test("an excluded item contributes $0 whatever its rate", () => {
    assert.deepEqual(
      priceFixedExtra({ included: false, rate: 2500 }, "Pump hire"),
      { amount: 0, issue: null },
    );
  });

  test("a selected item with no admin price is invalid, not $0", () => {
    const priced = priceFixedExtra({ included: true, rate: 0 }, "Benching");
    assert.equal(priced.amount, null);
    assert.match(priced.issue ?? "", /Benching has no price/);
  });
});

describe("piles", () => {
  test("10 screw piles at $200 each is $2,000", () => {
    assert.deepEqual(pricePiles(SCREW_10), { amount: 2000, issue: null });
    assert.equal(describePileCalculation(SCREW_10), "10 × $200.00 = $2,000.00");
  });

  test("10 bored piles × 8 m at $80 per metre is $6,400", () => {
    assert.deepEqual(pricePiles(BORED_10_X_8), { amount: 6400, issue: null });
    assert.equal(
      describePileCalculation(BORED_10_X_8),
      "10 × 8 m × $80.00 = $6,400.00",
    );
  });

  test("a bored length is priced at the precision it is shown", () => {
    const piles = { ...BORED_10_X_8, lengthPerPileM: 8.125 };
    assert.equal(pricePiles(piles).amount, 6504);
    assert.equal(
      describePileCalculation(piles),
      "10 × 8.13 m × $80.00 = $6,504.00",
    );
    assert.match(
      extraCostLines({ ...INITIAL_EXTRA_COSTS, piles })[0].offerTenderLineItem,
      /at 8\.13 m each/,
    );
    // Under half a centimetre prices as no length at all, and says so.
    assert.equal(pricePiles({ ...piles, lengthPerPileM: 0.004 }).amount, null);
  });

  test("piles switched off contribute $0", () => {
    assert.deepEqual(pricePiles({ ...BORED_10_X_8, included: false }), {
      amount: 0,
      issue: null,
    });
  });

  test("only the active pile type is priced", () => {
    // A bored length left over from an earlier choice does not touch a screw
    // price.
    assert.equal(pricePiles({ ...SCREW_10, lengthPerPileM: 8 }).amount, 2000);
  });

  test("missing or invalid inputs never produce a valid total", () => {
    const cases: readonly [string, OfferPilesConfig, RegExp][] = [
      ["no type", { ...SCREW_10, type: null }, /Choose Screw piles or Bored/],
      ["zero piles", { ...SCREW_10, quantity: 0 }, /whole number above zero/],
      ["part pile", { ...SCREW_10, quantity: 2.5 }, /whole number above zero/],
      ["no length", { ...BORED_10_X_8, lengthPerPileM: 0 }, /length of each/],
      ["no rate", { ...SCREW_10, rate: 0 }, /Screw piles have no rate/],
    ];
    for (const [name, piles, issue] of cases) {
      const priced = pricePiles(piles);
      assert.equal(priced.amount, null, name);
      assert.match(priced.issue ?? "", issue, name);
      const extras = { ...INITIAL_EXTRA_COSTS, piles };
      assert.deepEqual(extraCostLines(extras), [], name);
      assert.equal(collectExtraCostIssues(extras).length, 1, name);
    }
  });

  test("switching pile type takes that type's admin rate", () => {
    const enabled = setPilesIncluded(INITIAL_EXTRA_COSTS.piles, true, ADMIN);
    assert.equal(enabled.type, null);
    const screw = setPileType(enabled, "screw", ADMIN);
    assert.equal(screw.rate, 200);
    const bored = setPileType(screw, "bored", ADMIN);
    assert.equal(bored.rate, 80);
  });
});

describe("the cost lines the extras derive", () => {
  const ALL_ON: OfferExtraCosts = {
    pumpHire: { included: true, rate: 2500 },
    benching: { included: true, rate: 2000 },
    piles: BORED_10_X_8,
  };

  test("each selected item is one line, counted once in the direct total", () => {
    const workbook = buildInitialOfferWorkspaceSnapshot().lines;
    const before = calculateDirectTotal(workbook);
    const lines = withExtraCostLines(workbook, ALL_ON);
    assert.equal(calculateDirectTotal(lines), before + 2500 + 2000 + 6400);
    for (const id of Object.values(EXTRA_COST_LINE_IDS)) {
      assert.equal(lines.filter((line) => line.id === id).length, 1, id);
    }
  });

  test("re-deriving is idempotent and corrects a hand-edited line", () => {
    const once = withExtraCostLines([], ALL_ON);
    assert.deepEqual(withExtraCostLines(once, ALL_ON), once);
    const tampered = once.map((line) =>
      line.id === EXTRA_COST_LINE_IDS.pumpHire
        ? { ...line, costExGst: 1, includedInContract: false }
        : line,
    );
    assert.deepEqual(withExtraCostLines(tampered, ALL_ON), once);
  });

  test("an excluded item has no line", () => {
    assert.deepEqual(withExtraCostLines([], INITIAL_EXTRA_COSTS), []);
  });
});

describe("saved offers", () => {
  const configured: OfferExtraCosts = {
    pumpHire: { included: true, rate: 2500 },
    benching: { included: false, rate: 0 },
    piles: BORED_10_X_8,
  };

  test("the applied rates, inputs and amounts round-trip", () => {
    const persisted = serializeWorkspace(snapshotWith(configured));
    const restored = deserializeWorkspace(parseWorkspaceState(persisted));
    assert.deepEqual(restored.extraCosts, configured);
    const pileLine = restored.lines.find(
      (line) => line.id === EXTRA_COST_LINE_IDS.piles,
    );
    assert.equal(pileLine?.costExGst, 6400);
    assert.equal(
      restored.lines.some((line) => line.id === EXTRA_COST_LINE_IDS.benching),
      false,
    );
  });

  test("a save re-derives the lines whatever the caller sent", () => {
    // Eve replaces costLines wholesale; the extras come back from their
    // configuration rather than vanishing from the total.
    const snapshot = { ...snapshotWith(configured), lines: [] };
    const persisted = serializeWorkspace(snapshot);
    assert.deepEqual(
      persisted.costLines.map((line) => [line.id, line.costExGstCents]),
      [
        [EXTRA_COST_LINE_IDS.pumpHire, 250000],
        [EXTRA_COST_LINE_IDS.piles, 640000],
      ],
    );
  });

  test("an offer saved before the extras existed reads back unchanged", () => {
    const persisted = serializeWorkspace(snapshotWith(INITIAL_EXTRA_COSTS));
    const legacy: Record<string, unknown> = { ...persisted };
    delete legacy.extraCosts;
    const restored = deserializeWorkspace(parseWorkspaceState(legacy));
    assert.deepEqual(restored.extraCosts, INITIAL_EXTRA_COSTS);
    assert.deepEqual(serializeWorkspace(restored), persisted);
  });

  test("a later admin price change does not move a saved offer", () => {
    const persisted = serializeWorkspace(snapshotWith(configured));
    const restored = deserializeWorkspace(parseWorkspaceState(persisted));
    const moved = resolveExtraCostAdminRates({
      PUMP_HIRE: 3000,
      BORED_PILE_RATE_PER_M: 95,
    });
    // Nothing reads the admin price on the way back in…
    assert.equal(restored.extraCosts.pumpHire.rate, 2500);
    // …and the screen offers the change instead of applying it.
    assert.deepEqual(
      staleExtraCostRates(restored.extraCosts, moved).map((item) => [
        item.key,
        item.applied,
        item.current,
      ]),
      [
        ["pumpHire", 2500, 3000],
        ["piles", 80, 95],
      ],
    );
    const reapplied = reapplyExtraCostAdminRates(restored.extraCosts, moved);
    assert.equal(pricePiles(reapplied.piles).amount, 10 * 8 * 95);
    // Benching stays off, so it takes nothing.
    assert.deepEqual(reapplied.benching, configured.benching);
  });

  test("an issued offer's extras are frozen with its cost schedule", () => {
    const stored = serializeWorkspace(snapshotWith(configured));
    const incoming = serializeWorkspace(
      snapshotWith({
        ...configured,
        benching: { included: true, rate: 2000 },
      }),
    );
    const changes = lockedSnapshotChanges("sent", stored, incoming);
    assert.ok(changes.includes("extraCosts"));
    assert.ok(changes.includes("costLines"));
    assert.deepEqual(lockedSnapshotChanges("pending", stored, incoming), []);
  });

  test("an admin content re-seed keeps the extras' lines", () => {
    const snapshot = {
      ...snapshotWith(configured),
      lines: withExtraCostLines([], configured),
    };
    const prefill = {
      adminVersion: 9,
      buildScope: [],
      costLines: [],
      allowances: [],
      exclusions: [],
      draft: snapshot.draft,
      areaCalculator: snapshot.areaCalculator,
      rateConstants: {},
      loadingChargePercentage: 0,
    } satisfies AdminOfferPrefill;
    const next = applyAdminPrefillToSnapshot(snapshot, prefill);
    assert.equal(calculateDirectTotal(next.lines), 2500 + 6400);
  });
});

describe("send readiness", () => {
  test("an unpriceable extra blocks the send", () => {
    const issues = collectExtraCostIssues({
      ...INITIAL_EXTRA_COSTS,
      piles: { ...BORED_10_X_8, lengthPerPileM: 0 },
    });
    const blockers = collectOfferSendBlockers({
      hasLead: true,
      hasKnownFloorArea: true,
      needsOverrideReason: false,
      expiryState: "valid",
      extraCostIssues: issues,
    });
    assert.deepEqual(
      blockers.map((blocker) => [blocker.severity, blocker.stepId]),
      [["block", "offer-step-cost-schedule"]],
    );
  });
});
