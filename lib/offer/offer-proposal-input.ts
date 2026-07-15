import type { OfferWorkspaceSnapshot } from "./workspace-persistence";
import type { OfferPrintTemplateInput } from "./workspace-print-template";
import {
  calculateDirectTotal,
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  parseNonNegativeNumberInput,
} from "./workspace-pricing";
import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
} from "./workspace-area";

// Reconstruct the print-template input (prices, totals, etc.) from a persisted
// workspace snapshot — the same derivations the live container computes, so a
// server-generated proposal matches the on-screen one.
export function buildProposalInput(
  snapshot: OfferWorkspaceSnapshot,
): OfferPrintTemplateInput {
  const directTotal = calculateDirectTotal(snapshot.lines);
  const totalAreaSqm = getAreaBasisTotalSqm(
    offerAreaBasisFromJob(snapshot.job),
  );
  const pricing = calculateOfferWorkspacePricing({
    directTotal,
    totalAreaSqm,
    settings: snapshot.workspacePricingSettings,
  });
  const selectedPrice = parseNonNegativeNumberInput(snapshot.selectedPriceInput);
  const customerPrice = calculateOfferCustomerPrice({
    computedContractValueIncGst: pricing.contractValueIncGst,
    selectedContractValueIncGst: selectedPrice,
    overrideReason: snapshot.overrideReason,
  });
  const standardPriceIncGst = parseNonNegativeNumberInput(
    snapshot.standardPriceInput,
  );

  return {
    allowances: snapshot.allowances,
    customerPrice,
    draft: snapshot.draft,
    exclusions: snapshot.exclusions,
    job: snapshot.job,
    lines: snapshot.lines,
    paymentSchedule: snapshot.paymentSchedule,
    priceAdjustmentLabel: snapshot.priceAdjustmentLabel,
    standardPriceIncGst,
  };
}
