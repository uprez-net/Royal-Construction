import { roundCurrency } from "@/lib/offer/pricing";
import { OFFER_STAGE_CATALOG, type OfferStageCode } from "./workspace-model";
export { calculateRateCardComparison } from "./workspace-rate-card";
export type {
  RateCardComparison,
  RateCardProduct,
  RateCardStatus,
  RateCardTier,
} from "./workspace-rate-card";

export type MarginStatus =
  | "at_target"
  | "acceptable_below_target"
  | "below_minimum"
  // No cost to measure against yet, so there is no margin to judge.
  | "not_priced";

// Default HBCF *base* rate (ex GST & stamp duty) for H01 New Dwelling,
// metro — matches icare rates effective 1 Nov 2025. The premium helper below
// grosses this up with GST 10% + stamp duty 9% on (base+GST), matching the
// official HBCF premium calculator (portal.hbcf.nsw.gov.au).
// Verified: $650,000 → $7,528.52; $500,000 → $5,791.17.
export const DEFAULT_HBCF_RATE = 0.00966;
export const HBCF_GST_RATE = 0.1;
export const HBCF_STAMP_DUTY_RATE = 0.09;
// Compound gross-up used only to reverse-fill Total Contract Value from a
// known dollar premium (import / legacy hydrate). Equals
// (1 + GST) × (1 + stamp on base+GST) = 1.1 × 1.09 = 1.199.
export const HBCF_PREMIUM_GROSS_UP =
  (1 + HBCF_GST_RATE) * (1 + HBCF_STAMP_DUTY_RATE);

// The Royal quote build-up, verified against real project workbooks:
//   contract = (direct trade total + fixed additions)
//              × (1 + overhead% + fee%)   ← two levers, applied additively
//              × (1 + GST)
// The Royal Construction charge is two markups on the SAME cost base — Overhead
// and Fee — each rounded to the cent then summed (never compounded). Additions
// are the fixed cost lines the workbooks carry on top of the trades (HBCF and an
// impact fee); admin/labour/engineering/legal/licence were removed in #115 as
// they are captured once inside the Calculation Workbook's direct-cost lines.
export type OfferWorkspacePricingSettings = {
  readonly royalConstructionOverheadPct: number;
  readonly royalConstructionFeePct: number;
  readonly gstRate: number;
  // Estimator-entered total contract value used only to derive the HBCF
  // premium (#116). The premium itself is stored on homeWarrantyHbcfFixed.
  readonly hbcfTotalContractValue: number;
  // HBCF *base* rate (ex GST & stamp). Default is icare H01 metro 0.966%.
  readonly hbcfRate: number;
  readonly homeWarrantyHbcfFixed: number;
  readonly impactFeeFixed: number;
  // Loading charge as a WHOLE-NUMBER percent (5 = 5%), matching the admin HBCF
  // claim screen it is prefilled from. Applied to the whole grossed-up premium.
  readonly loadingChargePercentage: number;
};

// The loading charge icare adds for a builder's risk profile: a flat percentage
// of the WHOLE premium (base + GST + stamp), not another markup on the cost
// base. Percent is whole-number (5 = 5%) to match the admin screen's units.
export function calculateHbcfLoadingCharge(
  premiumBeforeLoading: number,
  loadingChargePercentage: number,
): number {
  if (!(premiumBeforeLoading > 0) || !(loadingChargePercentage > 0)) {
    return 0;
  }
  return roundCurrency(premiumBeforeLoading * (loadingChargePercentage / 100));
}

export type HbcfPremiumBreakdown = {
  // TCV × rate, ex GST and stamp duty.
  readonly basePremium: number;
  readonly gstAmount: number;
  readonly stampDuty: number;
  // base + GST + stamp — the icare calculator's headline figure.
  readonly premiumBeforeLoading: number;
  readonly loadingCharge: number;
  // What the build-up actually carries as homeWarrantyHbcfFixed.
  readonly totalPremium: number;
};

const EMPTY_HBCF_BREAKDOWN: HbcfPremiumBreakdown = {
  basePremium: 0,
  gstAmount: 0,
  stampDuty: 0,
  premiumBeforeLoading: 0,
  loadingCharge: 0,
  totalPremium: 0,
};

// Derive the HBCF / home-warranty premium the way the official icare calculator
// does: base = TCV × rate, then + GST 10%, then + stamp duty 9% on (base+GST),
// then + the loading charge on that whole figure. Returns zeroes when the
// contract value is absent or non-positive so the build-up can treat a blank
// TCV as "no HBCF yet" without NaN pollution.
export function calculateHbcfPremiumBreakdown(
  totalContractValue: number,
  rate: number = DEFAULT_HBCF_RATE,
  loadingChargePercentage = 0,
): HbcfPremiumBreakdown {
  if (!(totalContractValue > 0) || !(rate >= 0)) {
    return EMPTY_HBCF_BREAKDOWN;
  }
  const basePremium = roundCurrency(totalContractValue * rate);
  const gstAmount = roundCurrency(basePremium * HBCF_GST_RATE);
  const stampDuty = roundCurrency(
    (basePremium + gstAmount) * HBCF_STAMP_DUTY_RATE,
  );
  const premiumBeforeLoading = roundCurrency(
    basePremium + gstAmount + stampDuty,
  );
  const loadingCharge = calculateHbcfLoadingCharge(
    premiumBeforeLoading,
    loadingChargePercentage,
  );

  return {
    basePremium,
    gstAmount,
    stampDuty,
    premiumBeforeLoading,
    loadingCharge,
    totalPremium: roundCurrency(premiumBeforeLoading + loadingCharge),
  };
}

// The premium the build-up carries — grossed up AND loaded. The loading default
// of 0 keeps every legacy caller (and every offer saved before the loading
// charge shipped) on the exact icare figure.
export function calculateHbcfPremium(
  totalContractValue: number,
  rate: number = DEFAULT_HBCF_RATE,
  loadingChargePercentage = 0,
): number {
  return calculateHbcfPremiumBreakdown(
    totalContractValue,
    rate,
    loadingChargePercentage,
  ).totalPremium;
}

// Reverse of calculateHbcfPremium for import/legacy hydrate: given a known
// dollar premium, recover the Total Contract Value that produced it. The
// loading charge must be divided out here too, or re-deriving from the
// recovered TCV would apply it a second time.
export function reverseHbcfTotalContractValue(
  premium: number,
  rate: number = DEFAULT_HBCF_RATE,
  loadingChargePercentage = 0,
): number {
  if (!(premium > 0) || !(rate > 0)) {
    return 0;
  }
  const loadingMultiplier =
    loadingChargePercentage > 0 ? 1 + loadingChargePercentage / 100 : 1;
  return roundCurrency(
    premium / (rate * HBCF_PREMIUM_GROSS_UP * loadingMultiplier),
  );
}

// Keep homeWarrantyHbcfFixed in sync with the TCV × rate × loading inputs. Total
// Contract Value is the source of truth (#116): a blank/zero TCV yields a $0
// premium so clearing the field clears the addition. Imported dollar premiums
// reverse-fill TCV on load so they survive the same path.
export function withDerivedHbcfPremium(
  settings: OfferWorkspacePricingSettings,
): OfferWorkspacePricingSettings {
  const homeWarrantyHbcfFixed = calculateHbcfPremium(
    settings.hbcfTotalContractValue,
    settings.hbcfRate,
    settings.loadingChargePercentage,
  );
  return homeWarrantyHbcfFixed === settings.homeWarrantyHbcfFixed
    ? settings
    : { ...settings, homeWarrantyHbcfFixed };
}

// The breakdown behind the settings' stored premium — for the build-up panel,
// which shows the icare figure and the loading charge as separate lines.
export function describeHbcfPremium(
  settings: OfferWorkspacePricingSettings,
): HbcfPremiumBreakdown {
  return calculateHbcfPremiumBreakdown(
    settings.hbcfTotalContractValue,
    settings.hbcfRate,
    settings.loadingChargePercentage,
  );
}

export type OfferWorkspacePricingInput = {
  readonly directTotal: number;
  readonly totalAreaSqm: number;
  readonly settings: OfferWorkspacePricingSettings;
};

export type OfferWorkspacePricing = {
  readonly directTotal: number;
  readonly additionsTotal: number;
  readonly costBeforeFee: number;
  readonly royalConstructionOverhead: number;
  readonly royalConstructionFee: number;
  readonly totalIncludingConstruction: number;
  readonly gstAmount: number;
  readonly contractValueIncGst: number;
  readonly perSqm: number | null;
  // Echoed from the settings so a figure derived on another price (the summary
  // strip's GST on an overridden offer) splits at the rate this build-up used.
  readonly gstRate: number;
};

// The full markup applied to costBeforeFee (overhead + fee). The margin badge's
// "target" must be this combined markup, not one of the two levers — otherwise a
// 20%-markup job is measured against a 10% target and always reads "at target".
export function resolveTargetMarkupPct(
  settings: Pick<
    OfferWorkspacePricingSettings,
    "royalConstructionOverheadPct" | "royalConstructionFeePct"
  >,
): number {
  return (
    settings.royalConstructionOverheadPct + settings.royalConstructionFeePct
  );
}

// The margin the builder ACTUALLY earns at the price being charged. Kept
// separate from the cost build-up above because the selling price may be a
// manual override that the build-up (which just applied the target markup)
// cannot see — see calculateEffectiveMargin.
export type EffectiveMargin = {
  readonly effectiveMarkupPct: number;
  readonly marginStatus: MarginStatus;
};

export type OfferCustomerPriceInput = {
  readonly computedContractValueIncGst: number;
  readonly selectedContractValueIncGst: number | null;
  readonly overrideReason: string;
};

export type OfferCustomerPrice = {
  readonly computedContractValueIncGst: number;
  readonly selectedContractValueIncGst: number;
  readonly varianceIncGst: number;
  readonly hasManualOverride: boolean;
  readonly needsOverrideReason: boolean;
};

export type WorkspaceCostLinePricingInput = {
  readonly stageCode?: OfferStageCode;
  readonly costExGst: number;
  readonly includedInContract: boolean;
};

export type OfferStageSubtotal = {
  readonly stageCode: OfferStageCode;
  readonly stageName: string;
  readonly includedTotal: number;
  readonly rowCount: number;
  readonly includedRowCount: number;
};

export function calculateDirectTotal(
  lines: readonly WorkspaceCostLinePricingInput[],
): number {
  return roundCurrency(
    lines.reduce(
      (sum, line) => sum + (line.includedInContract ? line.costExGst : 0),
      0,
    ),
  );
}

export function calculateStageSubtotals(
  lines: readonly (WorkspaceCostLinePricingInput & {
    readonly stageCode: OfferStageCode;
  })[],
): readonly OfferStageSubtotal[] {
  return OFFER_STAGE_CATALOG.map((stage) => {
    const stageLines = lines.filter((line) => line.stageCode === stage.code);
    const includedLines = stageLines.filter((line) => line.includedInContract);

    return {
      stageCode: stage.code,
      stageName: stage.name,
      includedTotal: roundCurrency(
        includedLines.reduce((sum, line) => sum + line.costExGst, 0),
      ),
      rowCount: stageLines.length,
      includedRowCount: includedLines.length,
    };
  }).filter((stage) => stage.rowCount > 0);
}

export function parseNonNegativeNumberInput(value: string): number | null {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return parsedValue;
}

// Resolve an OPTIONAL price-override field (selected / standard price) to a
// concrete dollar amount or `null` meaning "no override — fall back to the
// computed price". Blank AND $0 both mean "no override": a real home-build
// contract is never $0, and — critically — an un-entered price round-trips
// through persistence as the string "0" (empty -> 0 cents -> "0"), so a plain
// empty-string check is not enough. The live workspace and the server-side
// proposal/Tender MUST both read these inputs through this one function, or the
// on-screen price and the emitted PDF diverge (a blank override rendered $0 on
// the customer-facing documents).
export function resolveOptionalPriceInput(value: string): number | null {
  const parsed = parseNonNegativeNumberInput(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function roundRate(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

// What a selling price ex GST earns over job cost, as a fraction of job cost.
// One definition for the markup badge and the profitability panel, which sit
// on the same screen.
function markupOnJobCost(sellingExGst: number, jobCost: number): number {
  return roundRate((sellingExGst - jobCost) / jobCost);
}

export function getMarginStatus(
  appliedMarkupPct: number,
  targetMarkupPct: number,
  minimumMarkupPct: number,
): MarginStatus {
  if (appliedMarkupPct < minimumMarkupPct) {
    return "below_minimum";
  }

  if (appliedMarkupPct >= targetMarkupPct) {
    return "at_target";
  }

  return "acceptable_below_target";
}

// Sum the fixed additions the workbooks carry on top of the trade lines. Admin,
// labour, engineering, legal and Master Builders licence were removed in #115 —
// they are captured once inside the Calculation Workbook's direct-cost lines.
export function calculateAdditionsTotal(
  settings: OfferWorkspacePricingSettings,
): number {
  return roundCurrency(
    settings.homeWarrantyHbcfFixed + settings.impactFeeFixed,
  );
}

export function calculateOfferWorkspacePricing({
  directTotal,
  totalAreaSqm,
  settings,
}: OfferWorkspacePricingInput): OfferWorkspacePricing {
  const additionsTotal = calculateAdditionsTotal(settings);
  const costBeforeFee = roundCurrency(directTotal + additionsTotal);
  // Two additive markups on the same base, each rounded to the cent then summed.
  const royalConstructionOverhead = roundCurrency(
    costBeforeFee * settings.royalConstructionOverheadPct,
  );
  const royalConstructionFee = roundCurrency(
    costBeforeFee * settings.royalConstructionFeePct,
  );
  const totalIncludingConstruction = roundCurrency(
    costBeforeFee + royalConstructionOverhead + royalConstructionFee,
  );
  const gstAmount = roundCurrency(
    totalIncludingConstruction * settings.gstRate,
  );
  const contractValueIncGst = roundCurrency(
    totalIncludingConstruction + gstAmount,
  );
  const perSqm =
    totalAreaSqm > 0 ? roundCurrency(contractValueIncGst / totalAreaSqm) : null;

  return {
    directTotal: roundCurrency(directTotal),
    additionsTotal,
    costBeforeFee,
    royalConstructionOverhead,
    royalConstructionFee,
    totalIncludingConstruction,
    gstAmount,
    contractValueIncGst,
    perSqm,
    gstRate: settings.gstRate,
  };
}

// Total Contract Value is the build-up's own contract value inc GST. The HBCF
// premium priced on it is one of that build-up's additions, so the two depend
// on each other: solve them together. Each pass re-prices the premium on the
// last contract value; the premium is about 1.5% of the price, so the gap
// shrinks some sixty-fold a pass and settles to the cent in three or four.
// Returns settings whose TCV equals the contract value they produce, or
// `settings` itself when they already do.
const TCV_MAX_PASSES = 12;

export function withDerivedTotalContractValue(
  settings: OfferWorkspacePricingSettings,
  directTotal: number,
): OfferWorkspacePricingSettings {
  const contractValueFor = (candidate: OfferWorkspacePricingSettings) =>
    calculateOfferWorkspacePricing({
      directTotal,
      totalAreaSqm: 0,
      settings: candidate,
    }).contractValueIncGst;
  let derived = withDerivedHbcfPremium(settings);
  for (let pass = 0; pass < TCV_MAX_PASSES; pass += 1) {
    const contractValue = contractValueFor(derived);
    if (contractValue === derived.hbcfTotalContractValue) {
      break;
    }
    derived = withDerivedHbcfPremium({
      ...derived,
      hbcfTotalContractValue: contractValue,
    });
  }
  return derived.hbcfTotalContractValue === settings.hbcfTotalContractValue
    && derived.homeWarrantyHbcfFixed === settings.homeWarrantyHbcfFixed
    ? settings
    : derived;
}

// The margin actually earned at the (possibly overridden) selling price, for
// the margin badge. This is what makes the below_minimum / acceptable_below_
// target warnings reachable: the cost build-up alone always reports the target
// markup, so an under-cost override would otherwise still read "at target".
// With no override the selling price is the computed contract value, so this
// reduces back to the target markup (badge stays green) — as expected.
export function calculateEffectiveMargin({
  costBeforeFee,
  sellingContractValueIncGst,
  gstRate,
  targetFeePct,
}: {
  readonly costBeforeFee: number;
  readonly sellingContractValueIncGst: number;
  readonly gstRate: number;
  readonly targetFeePct: number;
}): EffectiveMargin {
  // A blank offer, and every offer for the moment before it hydrates, has no
  // cost yet. Reading that as a 0% markup painted a red "Below minimum" badge on
  // something nobody had priced.
  if (!(costBeforeFee > 0)) {
    return { effectiveMarkupPct: 0, marginStatus: "not_priced" };
  }
  // The same ex-GST figure the offer stores (Offer.amount), so the markup is
  // measured on the price of record and agrees with the profitability panel.
  const sellingExGst = splitContractValueByGst({
    contractValueIncGst: sellingContractValueIncGst,
    gstRate,
  }).amountExGst;
  const effectiveMarkupPct = markupOnJobCost(sellingExGst, costBeforeFee);

  // Green at/above the target fee, amber while still profitable below it, red
  // once the selling price is at or below cost. The minimum is a strictly
  // positive epsilon so a break-even (0%) markup is a loss (red), not amber.
  return {
    effectiveMarkupPct,
    marginStatus: getMarginStatus(
      effectiveMarkupPct,
      targetFeePct,
      Number.EPSILON,
    ),
  };
}

export function calculateOfferCustomerPrice({
  computedContractValueIncGst,
  selectedContractValueIncGst,
  overrideReason,
}: OfferCustomerPriceInput): OfferCustomerPrice {
  const selectedPrice =
    selectedContractValueIncGst === null
      ? computedContractValueIncGst
      : selectedContractValueIncGst;
  const varianceIncGst = roundCurrency(
    selectedPrice - computedContractValueIncGst,
  );
  const hasManualOverride = varianceIncGst !== 0;

  return {
    computedContractValueIncGst,
    selectedContractValueIncGst: selectedPrice,
    varianceIncGst,
    hasManualOverride,
    needsOverrideReason:
      hasManualOverride && overrideReason.trim().length === 0,
  };
}

export type ContractValueGstSplit = {
  readonly amountExGst: number;
  readonly gstAmount: number;
  readonly totalIncGst: number;
};

// Split the inc-GST price of record into the ex-GST / GST / total triple stored
// on Offer.amount, Offer.gstAmount and Offer.totalAmount.
//
// It has to be a back-solve from the selected price rather than a read of
// calculateOfferWorkspacePricing's gstAmount: the estimator may override the
// contract value, and the cost build-up cannot see that override — so its GST
// line belongs to the COMPUTED price, not the one on the document the client
// receives. The printed proposal quotes a single inc-GST figure, so the ex-GST
// and GST components are only ever derivable this way.
//
// gstAmount is the remainder rather than an independent rounding of
// total × rate, so amount + gstAmount === totalIncGst exactly. The Offers list
// prints all three side by side, and a half-cent of independent rounding would
// show as a column that visibly fails to add up.
export function splitContractValueByGst({
  contractValueIncGst,
  gstRate,
}: {
  readonly contractValueIncGst: number;
  readonly gstRate: number;
}): ContractValueGstSplit {
  const totalIncGst = roundCurrency(contractValueIncGst);
  // A non-positive rate (or a nonsense one) would divide the price away; treat
  // it as "no GST component" so the total still reconciles.
  const divisor = 1 + gstRate;
  const amountExGst =
    Number.isFinite(divisor) && divisor > 0
      ? roundCurrency(totalIncGst / divisor)
      : totalIncGst;

  return {
    amountExGst,
    gstAmount: roundCurrency(totalIncGst - amountExGst),
    totalIncGst,
  };
}

// The share of each job's ex-GST selling price set aside for running the
// company: office, vehicles, insurance, the people who are not on a site.
//
// It is NOT the quote's "Overhead markup". That markup is a lever
// on the selling price, applied to job cost; this is what the business needs
// back out of the selling price, applied to revenue. Using the markup here
// would make every quote's projected profit come out at exactly the fee
// markup, whatever the company's real overhead is.
//
// `approved: false` until the business confirms the rate. The panel labels the
// figure illustrative while it is, so a projected profit is never read as one
// the business signed off. Change the rate and flip the flag together.
export const COMPANY_OVERHEAD_ALLOCATION = {
  rate: 0.06,
  approved: false,
} as const;

export type OfferProfitability = {
  readonly sellingPriceIncGst: number;
  readonly sellingPriceExGst: number;
  readonly gstAmount: number;
  // costBeforeFee: direct cost plus fixed additions, before either markup.
  readonly jobCost: number;
  // Every percentage is null on an unpriced quote (no job cost or no price),
  // because a percentage of nothing reads as a verdict on nothing.
  readonly effectiveMarkupPct: number | null;
  // Selling price ex GST less job cost. Negative when the offer is below cost.
  readonly grossProfit: number;
  readonly grossMarginPct: number | null;
  readonly companyOverheadRate: number;
  readonly companyOverhead: number;
  readonly projectedProfitBeforeTax: number;
  readonly projectedMarginBeforeTaxPct: number | null;
};

// Internal profitability at the price actually going on the offer. Measured on
// the SELECTED price ex GST, not the calculated build-up, so a discount or any
// other override shows its real cost to the business. Never on a customer
// document: nothing here is persisted or passed to a print template.
export function calculateOfferProfitability({
  jobCost,
  sellingContractValueIncGst,
  gstRate,
  companyOverheadRate = COMPANY_OVERHEAD_ALLOCATION.rate,
}: {
  readonly jobCost: number;
  readonly sellingContractValueIncGst: number;
  readonly gstRate: number;
  readonly companyOverheadRate?: number;
}): OfferProfitability {
  const split = splitContractValueByGst({
    contractValueIncGst: sellingContractValueIncGst,
    gstRate,
  });
  const sellingPriceExGst = split.amountExGst;
  const priced = jobCost > 0 && sellingPriceExGst > 0;
  const grossProfit = roundCurrency(sellingPriceExGst - jobCost);
  const companyOverhead = roundCurrency(
    sellingPriceExGst * companyOverheadRate,
  );
  const projectedProfitBeforeTax = roundCurrency(grossProfit - companyOverhead);
  const ofSellingPrice = (amount: number) =>
    priced ? roundRate(amount / sellingPriceExGst) : null;

  return {
    sellingPriceIncGst: split.totalIncGst,
    sellingPriceExGst,
    gstAmount: split.gstAmount,
    jobCost: roundCurrency(jobCost),
    effectiveMarkupPct: priced
      ? markupOnJobCost(sellingPriceExGst, jobCost)
      : null,
    grossProfit,
    grossMarginPct: ofSellingPrice(grossProfit),
    companyOverheadRate,
    companyOverhead,
    projectedProfitBeforeTax,
    projectedMarginBeforeTaxPct: ofSellingPrice(projectedProfitBeforeTax),
  };
}
