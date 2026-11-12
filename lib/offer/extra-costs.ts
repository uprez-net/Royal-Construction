import { roundCurrency } from "@/lib/offer/pricing";
import {
  DEFAULT_RATE_CONSTANTS,
  type RateConstantKey,
} from "@/lib/offer/formula-variables";
import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";

// Pump Hire, Benching and Piles: the three admin-priced extras an estimator
// switches on per offer. The one implementation of how each is priced, what
// makes one invalid, and the cost line it puts into the schedule.
//
// Why a cost line, and not a separate total: the direct total, the stage
// subtotals, the saved money columns, the project handoff and Eve all read the
// cost lines already. A second total beside them is a second place to forget,
// and the requirement is that each extra is counted exactly once. So the
// configuration below is the source of truth and the cost line is DERIVED from
// it by withExtraCostLines — the screen derives it on every render and
// serializeWorkspace derives it on every save, so no caller can hand-edit the
// line into disagreement with the configuration.
//
// Rates are STAMPED onto the offer when an item is switched on (or the pile
// type changes), from the admin rate constants of the moment. A saved offer
// keeps its stamped rate when Admin moves: an estimator re-applies the current
// rate with an explicit action, and only while the cost schedule is editable.
// A revision copies the snapshot, so it keeps the previous revision's rates
// until someone re-applies them. Nothing reprices silently.

export type PileType = "screw" | "bored";

export const PILE_TYPE_LABEL: Record<PileType, string> = {
  screw: "Screw piles",
  bored: "Bored piles",
};

export type OfferFixedExtraCost = {
  readonly included: boolean;
  // The admin price applied to this offer, ex GST. Meaningful while included.
  readonly rate: number;
};

export type OfferPilesConfig = {
  readonly included: boolean;
  // Required while included; null until the estimator picks one.
  readonly type: PileType | null;
  // A positive whole number while included.
  readonly quantity: number;
  // Metres per pile. Bored piles only; kept (not cleared) while screw piles
  // are selected so switching back does not lose what was typed.
  readonly lengthPerPileM: number;
  // The admin rate applied to the ACTIVE pile type: $ per pile for screw,
  // $ per linear metre for bored.
  readonly rate: number;
};

export type OfferExtraCosts = {
  readonly pumpHire: OfferFixedExtraCost;
  readonly benching: OfferFixedExtraCost;
  readonly piles: OfferPilesConfig;
};

export const INITIAL_EXTRA_COSTS: OfferExtraCosts = {
  pumpHire: { included: false, rate: 0 },
  benching: { included: false, rate: 0 },
  piles: {
    included: false,
    type: null,
    quantity: 0,
    lengthPerPileM: 0,
    rate: 0,
  },
};

// The admin-configured prices, as the offer engine reads them.
export type ExtraCostAdminRates = {
  readonly pumpHire: number;
  readonly benching: number;
  readonly screwPileRate: number;
  readonly boredPileRatePerM: number;
};

export function resolveExtraCostAdminRates(
  rateConstants: Partial<Record<RateConstantKey, number>>,
): ExtraCostAdminRates {
  const rc = { ...DEFAULT_RATE_CONSTANTS, ...rateConstants };
  return {
    pumpHire: rc.PUMP_HIRE,
    benching: rc.BENCHING,
    screwPileRate: rc.SCREW_PILE_RATE,
    boredPileRatePerM: rc.BORED_PILE_RATE_PER_M,
  };
}

export function pileAdminRate(
  rates: ExtraCostAdminRates,
  type: PileType,
): number {
  return type === "screw" ? rates.screwPileRate : rates.boredPileRatePerM;
}

// ─── Pricing ───

// The amount an extra adds to the direct total. `amount` is null when the item
// is switched on but cannot be priced; `issue` then says why, in a sentence an
// estimator can act on. An excluded item is $0 with no issue.
export type PricedExtraCost = {
  readonly amount: number | null;
  readonly issue: string | null;
};

const EXCLUDED: PricedExtraCost = { amount: 0, issue: null };

function invalid(issue: string): PricedExtraCost {
  return { amount: null, issue };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function priceFixedExtra(
  extra: OfferFixedExtraCost,
  label: string,
): PricedExtraCost {
  if (!extra.included) {
    return EXCLUDED;
  }
  if (!isPositiveFinite(extra.rate)) {
    return invalid(
      `${label} has no price. Set it under Admin → Cost schedule → Rate constants, then re-apply it here.`,
    );
  }
  return { amount: roundCurrency(extra.rate), issue: null };
}

export function pricePiles(piles: OfferPilesConfig): PricedExtraCost {
  if (!piles.included) {
    return EXCLUDED;
  }
  if (piles.type === null) {
    return invalid("Choose Screw piles or Bored piles on the Slab card.");
  }
  if (!Number.isInteger(piles.quantity) || piles.quantity <= 0) {
    return invalid(
      "Enter the number of piles on the Slab card as a whole number above zero.",
    );
  }
  if (piles.type === "bored" && !isPositiveFinite(piles.lengthPerPileM)) {
    return invalid(
      "Enter the length of each bored pile, in metres, on the Slab card.",
    );
  }
  if (!isPositiveFinite(piles.rate)) {
    return invalid(
      `${PILE_TYPE_LABEL[piles.type]} have no rate. Set it under Admin → Cost schedule → Rate constants, then re-apply it here.`,
    );
  }
  const amount =
    piles.type === "screw"
      ? piles.quantity * piles.rate
      : piles.quantity * piles.lengthPerPileM * piles.rate;
  return { amount: roundCurrency(amount), issue: null };
}

export type PricedExtraCosts = {
  readonly pumpHire: PricedExtraCost;
  readonly benching: PricedExtraCost;
  readonly piles: PricedExtraCost;
};

export function priceExtraCosts(extras: OfferExtraCosts): PricedExtraCosts {
  return {
    pumpHire: priceFixedExtra(extras.pumpHire, "Pump hire"),
    benching: priceFixedExtra(extras.benching, "Benching"),
    piles: pricePiles(extras.piles),
  };
}

// Every reason the extras cannot be priced as configured. An item in this
// state contributes nothing to the total, so a send with any of these would
// quote a price that silently leaves it out: callers block on a non-empty list.
export function collectExtraCostIssues(
  extras: OfferExtraCosts,
): readonly string[] {
  const priced = priceExtraCosts(extras);
  return [priced.pumpHire, priced.benching, priced.piles]
    .map((item) => item.issue)
    .filter((issue): issue is string => issue !== null);
}

// ─── The derived cost lines ───

export const EXTRA_COST_LINE_IDS = {
  pumpHire: "extra-cost-pump-hire",
  benching: "extra-cost-benching",
  piles: "extra-cost-piles",
} as const;

const EXTRA_COST_LINE_ID_SET: ReadonlySet<string> = new Set(
  Object.values(EXTRA_COST_LINE_IDS),
);

// True for a line withExtraCostLines owns. The editable workbook hides these:
// they are edited through their own controls, never as free-form rows.
export function isExtraCostLineId(id: string): boolean {
  return EXTRA_COST_LINE_ID_SET.has(id);
}

const currency2dp = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatExtraCostCurrency(value: number): string {
  return currency2dp.format(value);
}

const metres = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });

// "10 × $200.00 = $2,000.00" or "10 × 8 m × $80.00 = $6,400.00".
export function describePileCalculation(piles: OfferPilesConfig): string {
  const priced = pricePiles(piles);
  if (!piles.included || piles.type === null || priced.amount === null) {
    return "";
  }
  const length =
    piles.type === "bored" ? ` × ${metres.format(piles.lengthPerPileM)} m` : "";
  return `${piles.quantity}${length} × ${formatExtraCostCurrency(piles.rate)} = ${formatExtraCostCurrency(priced.amount)}`;
}

function extraCostLine(
  id: string,
  fields: Pick<
    OfferWorkspaceCostLine,
    "stageCode" | "itemName" | "offerTenderLineItem" | "notesOrSpec"
  >,
  amount: number,
): OfferWorkspaceCostLine {
  return {
    id,
    ...fields,
    buildingSequenceTasks: [],
    tradeOrVendor: "",
    costExGst: amount,
    includedInContract: true,
  };
}

// The cost lines the configuration puts into the schedule: one per included,
// priceable extra. An excluded item has no line ($0); an invalid one has no
// line either, and is reported by collectExtraCostIssues instead.
export function extraCostLines(
  extras: OfferExtraCosts,
): readonly OfferWorkspaceCostLine[] {
  const priced = priceExtraCosts(extras);
  const lines: OfferWorkspaceCostLine[] = [];
  if (extras.pumpHire.included && priced.pumpHire.amount !== null) {
    lines.push(
      extraCostLine(
        EXTRA_COST_LINE_IDS.pumpHire,
        {
          stageCode: "C",
          itemName: "Pump hire",
          offerTenderLineItem: "Concrete pump hire",
          notesOrSpec: `Fixed charge — ${formatExtraCostCurrency(extras.pumpHire.rate)}`,
        },
        priced.pumpHire.amount,
      ),
    );
  }
  if (extras.benching.included && priced.benching.amount !== null) {
    lines.push(
      extraCostLine(
        EXTRA_COST_LINE_IDS.benching,
        {
          stageCode: "B",
          itemName: "Benching",
          offerTenderLineItem: "Site benching",
          notesOrSpec: `Fixed charge — ${formatExtraCostCurrency(extras.benching.rate)}`,
        },
        priced.benching.amount,
      ),
    );
  }
  const { piles } = extras;
  if (piles.included && piles.type !== null && priced.piles.amount !== null) {
    const label = PILE_TYPE_LABEL[piles.type];
    const count = `${piles.quantity} ${piles.quantity === 1 ? "pile" : "piles"}`;
    lines.push(
      extraCostLine(
        EXTRA_COST_LINE_IDS.piles,
        {
          stageCode: "C",
          itemName: label,
          offerTenderLineItem:
            piles.type === "bored"
              ? `${label} — ${count} at ${metres.format(piles.lengthPerPileM)} m each`
              : `${label} — ${count}`,
          notesOrSpec: describePileCalculation(piles),
        },
        priced.piles.amount,
      ),
    );
  }
  return lines;
}

// `lines` with the extras' lines replaced by the ones the configuration
// derives, appended after the workbook rows. Idempotent: whatever extras lines
// `lines` already carries — stale, hand-edited, or none — are dropped first.
export function withExtraCostLines(
  lines: readonly OfferWorkspaceCostLine[],
  extras: OfferExtraCosts,
): readonly OfferWorkspaceCostLine[] {
  return [
    ...lines.filter((line) => !isExtraCostLineId(line.id)),
    ...extraCostLines(extras),
  ];
}

// ─── Edits, with rate stamping ───
//
// The screen edits the configuration only through these, so a rate is taken
// from Admin exactly when a pricing decision is made, and never otherwise.

export function setFixedExtraIncluded(
  extra: OfferFixedExtraCost,
  included: boolean,
  adminRate: number,
): OfferFixedExtraCost {
  if (included === extra.included) {
    return extra;
  }
  // Switching an item on is a fresh pricing decision: it takes today's price.
  return included
    ? { included: true, rate: adminRate }
    : { ...extra, included };
}

export function setPilesIncluded(
  piles: OfferPilesConfig,
  included: boolean,
  rates: ExtraCostAdminRates,
): OfferPilesConfig {
  if (included === piles.included) {
    return piles;
  }
  if (!included) {
    return { ...piles, included: false };
  }
  return {
    ...piles,
    included: true,
    rate: piles.type === null ? 0 : pileAdminRate(rates, piles.type),
  };
}

export function setPileType(
  piles: OfferPilesConfig,
  type: PileType,
  rates: ExtraCostAdminRates,
): OfferPilesConfig {
  if (type === piles.type && piles.rate > 0) {
    return piles;
  }
  // Only the active type's rate is ever applied, so a switch re-reads it.
  return { ...piles, type, rate: pileAdminRate(rates, type) };
}

// Included extras whose applied rate differs from the current admin rate. The
// screen offers to re-apply them; it never does so on its own.
export type StaleExtraCostRate = {
  readonly key: keyof OfferExtraCosts;
  readonly label: string;
  readonly applied: number;
  readonly current: number;
};

export function staleExtraCostRates(
  extras: OfferExtraCosts,
  rates: ExtraCostAdminRates,
): readonly StaleExtraCostRate[] {
  const stale: StaleExtraCostRate[] = [];
  if (extras.pumpHire.included && extras.pumpHire.rate !== rates.pumpHire) {
    stale.push({
      key: "pumpHire",
      label: "Pump hire",
      applied: extras.pumpHire.rate,
      current: rates.pumpHire,
    });
  }
  if (extras.benching.included && extras.benching.rate !== rates.benching) {
    stale.push({
      key: "benching",
      label: "Benching",
      applied: extras.benching.rate,
      current: rates.benching,
    });
  }
  const { piles } = extras;
  if (piles.included && piles.type !== null) {
    const current = pileAdminRate(rates, piles.type);
    if (piles.rate !== current) {
      stale.push({
        key: "piles",
        label: PILE_TYPE_LABEL[piles.type],
        applied: piles.rate,
        current,
      });
    }
  }
  return stale;
}

// Re-apply today's admin rates to every included extra. An explicit action.
export function reapplyExtraCostAdminRates(
  extras: OfferExtraCosts,
  rates: ExtraCostAdminRates,
): OfferExtraCosts {
  return {
    pumpHire: extras.pumpHire.included
      ? { ...extras.pumpHire, rate: rates.pumpHire }
      : extras.pumpHire,
    benching: extras.benching.included
      ? { ...extras.benching, rate: rates.benching }
      : extras.benching,
    piles:
      extras.piles.included && extras.piles.type !== null
        ? { ...extras.piles, rate: pileAdminRate(rates, extras.piles.type) }
        : extras.piles,
  };
}
