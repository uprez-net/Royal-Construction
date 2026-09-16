import { roundCurrency } from "./pricing";
import {
  splitContractValueByGst,
  type OfferCustomerPrice,
  type OfferWorkspacePricing,
} from "./workspace-pricing";

// The figures the summary strip prints beside its hero contract value.
//
// They are on the basis of the price going on the offer, the SELECTED contract
// value, because that is the hero figure and the one the send gate checks. The
// cost build-up cannot see an override, so its gstAmount and perSqm belong to
// the computed price: a $900,000 offer over a $950,000 build-up printed the GST
// of $950,000 beside a $900,000 total.
export type OfferSummaryFigures = {
  readonly gstOnOffer: number;
  readonly perSqm: number | null;
  // The send gate's own flag (needsOverrideReason derives from it). The strip
  // used to compare whole dollars, so a cents override blocked Send while the
  // chip that explains it never appeared.
  readonly overridden: boolean;
  // Signed: negative when the offer is below the build-up.
  readonly overrideDeltaIncGst: number;
};

export function buildOfferSummaryFigures({
  customerPrice,
  pricing,
  totalAreaSqm,
}: {
  readonly customerPrice: OfferCustomerPrice;
  readonly pricing: OfferWorkspacePricing;
  readonly totalAreaSqm: number;
}): OfferSummaryFigures {
  const selected = customerPrice.selectedContractValueIncGst;

  return {
    gstOnOffer: splitContractValueByGst({
      contractValueIncGst: selected,
      gstRate: pricing.gstRate,
    }).gstAmount,
    perSqm: totalAreaSqm > 0 ? roundCurrency(selected / totalAreaSqm) : null,
    overridden: customerPrice.hasManualOverride,
    overrideDeltaIncGst: customerPrice.varianceIncGst,
  };
}
