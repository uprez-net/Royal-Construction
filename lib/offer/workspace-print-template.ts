import type {
  OfferDocumentDraft,
  OfferScopeAmountType,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
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
  readonly validUntilLabel: string;
};

export type OfferPrintTemplateInput = {
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly job: OfferWorkspaceJob;
  // Carried by every caller and part of the workspace-shaped input, but no
  // longer read here: the printed inclusions now come from draft.inclusionSchedule,
  // which the estimator edits, rather than being derived from cost lines behind
  // their back.
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly priceAdjustmentLabel: string;
  readonly standardPriceIncGst: number | null;
  // When the offer was drawn up. Omitted for a live draft (defaults to today);
  // supplied when re-rendering a historical revision, so the document is not
  // restamped with the date it happened to be viewed. Must be a Date —
  // formatDateDisplay parses strings as date-only local values.
  readonly preparedDate?: Date;
};

export function buildOfferPrintTemplateData({
  allowances,
  customerPrice,
  draft,
  exclusions,
  job,
  paymentSchedule,
  priceAdjustmentLabel,
  standardPriceIncGst,
  preparedDate,
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
    preparedDateLabel: formatDateDisplay(preparedDate ?? new Date()),
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
    validUntilLabel: formatDateDisplay(job.validUntil),
  };
}

export function formatArea(value: number): string {
  return `${new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: 2,
  }).format(value)} m²`;
}

// The "Lot Area … | Zoning …" line under the site address on the proposal
// snapshot. Unfilled particulars are dropped rather than printed: "Lot Area:
// 0 m²" reads to a client as a surveyed measurement of zero, and a bare
// "Zoning:" label with nothing after it reads as an omission from the contract.
// Returns "" when neither is known, so the caller can drop the line entirely.
export function formatSiteParticulars(
  job: Pick<OfferWorkspaceJob, "lotAreaSqm" | "zoning">,
): string {
  const parts: string[] = [];

  if (job.lotAreaSqm > 0) {
    parts.push(`Lot Area: ${formatArea(job.lotAreaSqm)}`);
  }
  if (job.zoning.trim().length > 0) {
    parts.push(`Zoning: ${job.zoning.trim()}`);
  }

  return parts.join(" | ");
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
  totalPages: number,
): string {
  return `${footerBase} | Page ${pageNumber} of ${totalPages}`;
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

// The one rule for what prints as an exclusion: the estimator's free-text
// bullets UNION the Scope step's exclusion items, deduped. Every surface — the
// offer PDF, the tender, the on-screen preview and the tender view — resolves
// through this. They previously each had their own rule (union / scope-only /
// bullets-as-override), so nothing on screen predicted the client's document.
export function getVisibleExclusions(
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
