import { roundCurrency } from "@/lib/offer/pricing";

export type MarginStatus =
  | "at_target"
  | "acceptable_below_target"
  | "below_minimum";

export type OfferWorkspacePricingSettings = {
  readonly targetMarkupPct: number;
  readonly minimumMarkupPct: number;
  readonly gstRate: number;
  readonly hbcfRate: number;
  readonly adminCostFixed: number;
  readonly projectManagementCostFixed: number;
  readonly contingencyPct: number;
};

export type LegacyWorkbookPricingSettings = {
  readonly overheadPct: number;
  readonly royalConstructionFeePct: number;
  readonly hbcfInsuranceFixed: number;
  readonly adminCostFixed: number;
  readonly labourCostFixed: number;
  readonly otherAdjustmentFixed: number;
};

export type OfferWorkspacePricingInput = {
  readonly directTotal: number;
  readonly totalAreaSqm: number;
  readonly settings: OfferWorkspacePricingSettings;
};

export type OfferWorkspacePricing = {
  readonly directTotal: number;
  readonly hbcfInsurance: number;
  readonly adminCost: number;
  readonly projectManagementCost: number;
  readonly contingency: number;
  readonly costBase: number;
  readonly builderMargin: number;
  readonly subtotalExGst: number;
  readonly gstAmount: number;
  readonly contractValueIncGst: number;
  readonly perSqm: number | null;
  readonly appliedMarkupPct: number;
  readonly marginStatus: MarginStatus;
};

export type LegacyWorkbookPricing = {
  readonly directTotal: number;
  readonly overhead: number;
  readonly royalConstructionFee: number;
  readonly hbcfInsurance: number;
  readonly adminCost: number;
  readonly labourCost: number;
  readonly otherAdjustment: number;
  readonly totalIncludingConstructionCost: number;
  readonly perSqm: number | null;
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
  readonly costExGst: number;
  readonly includedInContract: boolean;
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

export function parseNonNegativeNumberInput(value: string): number | null {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return parsedValue;
}

function roundRate(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
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

export function calculateOfferWorkspacePricing({
  directTotal,
  totalAreaSqm,
  settings,
}: OfferWorkspacePricingInput): OfferWorkspacePricing {
  const hbcfInsurance = roundCurrency(directTotal * settings.hbcfRate);
  const adminCost = roundCurrency(settings.adminCostFixed);
  const projectManagementCost = roundCurrency(
    settings.projectManagementCostFixed,
  );
  const contingency = roundCurrency(directTotal * settings.contingencyPct);
  const costBase = roundCurrency(
    directTotal +
      hbcfInsurance +
      adminCost +
      projectManagementCost +
      contingency,
  );
  const builderMargin = roundCurrency(costBase * settings.targetMarkupPct);
  const subtotalExGst = roundCurrency(costBase + builderMargin);
  const gstAmount = roundCurrency(subtotalExGst * settings.gstRate);
  const contractValueIncGst = roundCurrency(subtotalExGst + gstAmount);
  const perSqm =
    totalAreaSqm > 0 ? roundCurrency(contractValueIncGst / totalAreaSqm) : null;
  const appliedMarkupPct =
    costBase > 0 ? roundRate(builderMargin / costBase) : 0;

  return {
    directTotal: roundCurrency(directTotal),
    hbcfInsurance,
    adminCost,
    projectManagementCost,
    contingency,
    costBase,
    builderMargin,
    subtotalExGst,
    gstAmount,
    contractValueIncGst,
    perSqm,
    appliedMarkupPct,
    marginStatus: getMarginStatus(
      appliedMarkupPct,
      settings.targetMarkupPct,
      settings.minimumMarkupPct,
    ),
  };
}

export function calculateLegacyWorkbookPricing({
  directTotal,
  settings,
  totalAreaSqm,
}: {
  readonly directTotal: number;
  readonly settings: LegacyWorkbookPricingSettings;
  readonly totalAreaSqm: number;
}): LegacyWorkbookPricing {
  const overhead = roundCurrency(directTotal * settings.overheadPct);
  const royalConstructionFee = roundCurrency(
    directTotal * settings.royalConstructionFeePct,
  );
  const hbcfInsurance = roundCurrency(settings.hbcfInsuranceFixed);
  const adminCost = roundCurrency(settings.adminCostFixed);
  const labourCost = roundCurrency(settings.labourCostFixed);
  const otherAdjustment = roundCurrency(settings.otherAdjustmentFixed);
  const totalIncludingConstructionCost = roundCurrency(
    directTotal +
      overhead +
      royalConstructionFee +
      hbcfInsurance +
      adminCost +
      labourCost +
      otherAdjustment,
  );

  return {
    directTotal: roundCurrency(directTotal),
    overhead,
    royalConstructionFee,
    hbcfInsurance,
    adminCost,
    labourCost,
    otherAdjustment,
    totalIncludingConstructionCost,
    perSqm:
      totalAreaSqm > 0
        ? roundCurrency(totalIncludingConstructionCost / totalAreaSqm)
        : null,
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
