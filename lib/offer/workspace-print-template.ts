import type {
  OfferDocumentDraft,
  OfferScopeAmountType,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import {
  offerAreaBasisFromJob,
  rawTotalAreaSqm,
} from "@/lib/offer/workspace-area";
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

// A printed exclusion with the detail the Scope step already captures. The
// tender prints all three columns; the offer prints the label alone, because
// the offer sells and the tender carries the obligation.
export type OfferPrintExclusionRow = {
  readonly label: string;
  readonly description: string;
  readonly variationRule: string;
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
  readonly exclusionRows: readonly OfferPrintExclusionRow[];
  readonly footerBase: string;
  readonly paymentRows: readonly OfferPrintPaymentRow[];
  readonly priceLine: string;
  readonly preparedDateLabel: string;
  readonly savingAmount: number | null;
  readonly scopeRows: readonly OfferPrintScopeRow[];
  // The "This price includes" list on the Investment Summary page, derived from
  // the inclusions schedule's summary labels. Derived HERE rather than in each
  // renderer — the three renderers have drifted before.
  readonly summaryInclusions: readonly string[];
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
    // The offer document is edited in the Offer phase, so its short client-
    // facing exclusion list must come only from that editable draft. Scope
    // exclusions remain available to the Tender via `exclusionRows` below,
    // but must not reappear here after an estimator removes them from the
    // Offer document.
    exclusionBullets: getOfferDocumentExclusions(draft),
    exclusionRows: getVisibleExclusionRows(draft, exclusions),
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
        // Estimators routinely put the same sentence in both fields — across
        // real offers most rows have description === variationRule, and many
        // leave the description blank. Printing it twice side by side on a
        // fixed-price proposal reads as a rendering fault, so the duplicate is
        // dropped HERE rather than in each renderer: the offer and the emailed
        // PDF must not diverge on this.
        description:
          item.description.trim() === item.variationRule.trim()
            ? ""
            : item.description,
        id: item.id,
        label: item.label,
        variationRule: item.variationRule,
      })),
    summaryInclusions: draft.inclusionHighlights
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    validUntilLabel: formatDateDisplay(job.validUntil),
  };
}

export function formatArea(value: number): string {
  return `${new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: 2,
  }).format(value)} m²`;
}

// Room counts for one dwelling — the major house or its granny home. Bathrooms
// are captured as a decimal (a powder room is half a bathroom), so counts print
// as entered rather than integer-formatted.
export type OfferDwellingSpec = {
  readonly bathrooms: number;
  readonly bedrooms: number;
  readonly garageSpaces: number;
};

export function formatRoomCount(value: number): string {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(
    value,
  );
}

// The major house / granny home spec as one line, for the tender's Project
// Particulars table where a full sub-table would push the cover page over.
export function formatDwellingSpec(spec: OfferDwellingSpec): string {
  return [
    `${formatRoomCount(spec.bedrooms)} bedrooms`,
    `${formatRoomCount(spec.bathrooms)} bathrooms`,
    `${formatRoomCount(spec.garageSpaces)} garage spaces`,
  ].join(" | ");
}

// The granny-home counts, or null when the build has no granny home — callers
// drop their "Granny Home Specifications" section entirely in that case rather
// than printing a dwelling of zero rooms.
export function grannyDwellingSpec(
  job: Pick<
    OfferWorkspaceJob,
    | "hasGrannyHome"
    | "grannyBathrooms"
    | "grannyBedrooms"
    | "grannyGarageSpaces"
  >,
): OfferDwellingSpec | null {
  if (!job.hasGrannyHome) {
    return null;
  }
  return {
    bathrooms: job.grannyBathrooms,
    bedrooms: job.grannyBedrooms,
    garageSpaces: job.grannyGarageSpaces,
  };
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
  return rawTotalAreaSqm(offerAreaBasisFromJob(job));
}

export type OfferAreaCell = {
  readonly label: string;
  readonly sqm: number;
};

export type OfferAreaBreakdown = {
  readonly cells: readonly OfferAreaCell[];
  readonly totalSqm: number;
};

// The snapshot page's area grid, and the one total every document prints.
//
// Each renderer summed its own subset: the emailed PDF left out balcony and void,
// the printed copy left out void and showed a Kitchen cell that was never in any
// total, and the Tender and welcome letter left out both. A client could read
// three different build areas across one proposal and its Tender. The cells here
// partition rawTotalAreaSqm exactly — the figure the cover and the cost formulas
// already use — so the grid adds up to the total beneath it. A cell is dropped
// only when it contributes nothing to that total.
export function buildAreaBreakdown(job: OfferWorkspaceJob): OfferAreaBreakdown {
  const cells: OfferAreaCell[] = [
    { label: "Ground Floor + Garage", sqm: job.groundFloorSqm + job.garageSqm },
    { label: "First Floor", sqm: job.firstFloorSqm },
    { label: "Alfresco + Balcony", sqm: job.alfrescoPorchSqm + job.balconySqm },
    { label: "Porch", sqm: job.porchSqm },
  ];
  if (job.voidSqm !== 0) {
    cells.push({ label: "Void", sqm: job.voidSqm });
  }
  if (job.grannyFlatSqm !== 0) {
    cells.push({ label: "Granny Flat", sqm: job.grannyFlatSqm });
  }
  // A base cell with no area (a single-storey job's First Floor, a job with no
  // porch) is dropped like Void and Granny Flat above, so nothing prints "0 m²".
  return {
    cells: cells.filter((cell) => cell.sqm !== 0),
    totalSqm: getTotalAreaSqm(job),
  };
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

// The Offer phase owns the short, client-facing exclusion list. Keep the list
// normalized at the print-data boundary so removed/blank draft rows do not
// leak into the printed document through Scope state.
export function getOfferDocumentExclusions(
  draft: Pick<OfferDocumentDraft, "exclusionBullets">,
): readonly string[] {
  const labels = new Set<string>();
  for (const label of draft.exclusionBullets) {
    const trimmed = label.trim();
    if (trimmed.length > 0) {
      labels.add(trimmed);
    }
  }
  return [...labels];
}

// The Tender carries the detailed Scope exclusions as well as any short
// exclusion bullets written in the Offer phase. This resolver is intentionally
// separate from getOfferDocumentExclusions: Scope data must not repopulate the
// client-facing Offer list after the estimator removes a line there.
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

// The Tender version of getVisibleExclusions, carrying the description and
// variation rule a Scope item holds. The offer intentionally keeps the short
// label-only list above; a free-text bullet has no Scope detail to carry.
export function getVisibleExclusionRows(
  draft: OfferDocumentDraft,
  exclusions: readonly OfferWorkspaceScopeItem[],
): readonly OfferPrintExclusionRow[] {
  const rows = new Map<string, OfferPrintExclusionRow>();
  for (const label of draft.exclusionBullets) {
    const key = label.trim();
    if (key.length > 0 && !rows.has(key)) {
      rows.set(key, { label: key, description: "", variationRule: "" });
    }
  }
  for (const item of exclusions) {
    if (!item.includedInOfferDocument) continue;
    const key = item.label.trim();
    if (key.length === 0) continue;
    // A Scope item's detail wins over a bare bullet of the same label.
    rows.set(key, {
      label: key,
      description: item.description.trim(),
      variationRule: item.variationRule.trim(),
    });
  }
  return [...rows.values()];
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
