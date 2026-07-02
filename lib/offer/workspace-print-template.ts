import type {
  OfferDocumentDraft,
  OfferScopeAmountType,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import { getIncludedOfferTenderLineItems } from "@/lib/offer/workspace-model";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";

export const COMPANY_LINE =
  "ROYAL CONSTRUCTIONS PTY LTD | Licence No. 383992C | ABN 56 644 111 580 | MBA Accredited";
export const PROPOSAL_TAGLINE =
  "Fixed Price. No Surprises. Built by People Who Care.";

const SQUARE_METRES_PER_SQUARE = 9.290304;

export type OfferPrintPaymentRow = {
  readonly id: string;
  readonly amount: number;
  readonly percentOfContract: number;
  readonly stageName: string;
  readonly trigger: string;
};

export type OfferPrintScopeRow = {
  readonly amountLabel: string;
  readonly description: string;
  readonly id: string;
  readonly label: string;
  readonly variationRule: string;
};

export type OfferPrintTemplateData = {
  readonly areaLabel: string;
  readonly exclusionBullets: readonly string[];
  readonly footerBase: string;
  readonly paymentRows: readonly OfferPrintPaymentRow[];
  readonly priceLine: string;
  readonly preparedDateLabel: string;
  readonly savingAmount: number | null;
  readonly scopeRows: readonly OfferPrintScopeRow[];
  readonly offerTenderLineItems: readonly string[];
  readonly validUntilLabel: string;
};

export type OfferPrintTemplateInput = {
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly job: OfferWorkspaceJob;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly priceAdjustmentLabel: string;
  readonly standardPriceIncGst: number | null;
};

export function buildOfferPrintTemplateData({
  allowances,
  customerPrice,
  draft,
  exclusions,
  job,
  lines,
  paymentSchedule,
  priceAdjustmentLabel,
  standardPriceIncGst,
}: OfferPrintTemplateInput): OfferPrintTemplateData {
  const selectedPrice = customerPrice.selectedContractValueIncGst;
  const savingAmount =
    standardPriceIncGst !== null ? standardPriceIncGst - selectedPrice : null;

  return {
    areaLabel: getAreaLabel(getTotalAreaSqm(job)),
    exclusionBullets: getVisibleExclusions(draft, exclusions),
    footerBase: `${job.siteAddress} | Prepared by ${job.preparedBy}`,
    paymentRows: paymentSchedule.map((row) => ({
      ...row,
      amount: selectedPrice * row.percentOfContract,
    })),
    preparedDateLabel: formatDateDisplay(new Date()),
    priceLine: getPriceLine(selectedPrice, standardPriceIncGst, priceAdjustmentLabel),
    savingAmount,
    scopeRows: allowances
      .filter((item) => item.includedInOfferDocument)
      .map((item) => ({
        amountLabel: formatScopeAmount(item.amountType, item.amount, item.unit),
        description: item.description,
        id: item.id,
        label: item.label,
        variationRule: item.variationRule,
      })),
    offerTenderLineItems: getIncludedOfferTenderLineItems(lines),
    validUntilLabel: formatDateDisplay(job.validUntil),
  };
}

export function formatArea(value: number): string {
  return `${new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: 2,
  }).format(value)} m²`;
}

export function formatDateDisplay(value: Date | string): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;

  if (!Number.isFinite(date.getTime())) {
    return typeof value === "string" ? value : "-";
  }

  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function getPrintFooterText(
  footerBase: string,
  pageNumber: number,
): string {
  return `${footerBase} | Page ${pageNumber} of 4`;
}

function getTotalAreaSqm(job: OfferWorkspaceJob): number {
  return (
    job.groundFloorSqm +
    job.firstFloorSqm +
    job.garageSqm +
    job.alfrescoPorchSqm +
    job.porchSqm +
    job.grannyFlatSqm
  );
}

function getAreaLabel(totalAreaSqm: number): string {
  return `${formatArea(totalAreaSqm)} (${formatSquares(totalAreaSqm)} squares)`;
}

function formatSquares(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: 2,
  }).format(value / SQUARE_METRES_PER_SQUARE);
}

function getPriceLine(
  selectedPrice: number,
  standardPrice: number | null,
  priceAdjustmentLabel: string,
): string {
  if (standardPrice !== null && standardPrice > selectedPrice) {
    return `${formatCurrencyText(selectedPrice)} incl. GST - ${priceAdjustmentLabel || "Fixed price"} (was ${formatCurrencyText(standardPrice)})`;
  }

  return `${formatCurrencyText(selectedPrice)} incl. GST`;
}

function getVisibleExclusions(
  draft: OfferDocumentDraft,
  exclusions: readonly OfferWorkspaceScopeItem[],
): readonly string[] {
  return Array.from(
    new Set([
      ...draft.exclusionBullets,
      ...exclusions
        .filter((item) => item.includedInOfferDocument)
        .map((item) => item.label),
    ]),
  );
}

function formatScopeAmount(
  amountType: OfferScopeAmountType,
  amount: number,
  unit: string,
): string {
  switch (amountType) {
    case "fixed_amount":
      return formatCurrencyText(amount);
    case "rate_per_sqm":
      return `${formatCurrencyText(amount)}/${unit}`;
    case "included_note":
      return "Included";
  }
}

function formatCurrencyText(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}
