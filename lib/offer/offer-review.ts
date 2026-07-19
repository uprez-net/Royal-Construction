// Pure completeness review of the Offer-build steps, mirroring the "review
// before you send" surface: each section reports Complete/Incomplete, the exact
// gaps, and a compact read-only summary. Side-effect free so it can be unit
// tested and reused by the review panel and any send gate.
import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import type {
  OfferDocumentDraft,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";

export type OfferReviewStatus = "complete" | "incomplete";

export type OfferReviewRow = {
  readonly label: string;
  readonly value: string;
};

export type OfferReviewSection = {
  readonly id: string;
  // The step section anchor id, for scroll-to-edit.
  readonly stepId: string;
  readonly title: string;
  readonly status: OfferReviewStatus;
  // What's missing when incomplete (empty when complete).
  readonly issues: readonly string[];
  // Compact read-only facts shown when the section is expanded.
  readonly rows: readonly OfferReviewRow[];
};

export type OfferReviewInput = {
  readonly job: OfferWorkspaceJob;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly draft: OfferDocumentDraft;
  readonly customerPrice: OfferCustomerPrice;
};

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function section(
  s: Omit<OfferReviewSection, "status"> & { readonly issues: readonly string[] },
): OfferReviewSection {
  return { ...s, status: s.issues.length === 0 ? "complete" : "incomplete" };
}

export function buildOfferReview(
  input: OfferReviewInput,
): readonly OfferReviewSection[] {
  const { job, lines, allowances, exclusions, draft, customerPrice } = input;
  const totalAreaSqm = getAreaBasisTotalSqm(offerAreaBasisFromJob(job));
  const pricedLines = lines.filter((line) => line.costExGst > 0);
  const directTotal = pricedLines.reduce((sum, line) => sum + line.costExGst, 0);
  const shownAllowances = allowances.filter(
    (item) => item.includedInOfferDocument,
  );
  const shownExclusions = exclusions.filter(
    (item) => item.includedInOfferDocument,
  );

  return [
    section({
      id: "job-setup",
      stepId: "offer-step-job-setup",
      title: "Job setup",
      issues: [
        job.clientNames.trim().length === 0 && "Client names",
        job.siteAddress.trim().length === 0 && "Site address",
        job.buildType.trim().length === 0 && "Build type",
        totalAreaSqm <= 0 && "Floor areas",
      ]
        .filter((v): v is string => Boolean(v))
        .map((field) => `${field} is missing.`),
      rows: [
        { label: "Client", value: job.clientNames || "—" },
        { label: "Site", value: job.siteAddress || "—" },
        { label: "Build type", value: job.buildType || "—" },
        { label: "Total area", value: `${totalAreaSqm} sqm` },
      ],
    }),
    section({
      id: "cost-schedule",
      stepId: "offer-step-cost-schedule",
      title: "Cost schedule",
      issues:
        pricedLines.length === 0
          ? ["No priced cost lines yet — add values to build the offer."]
          : [],
      rows: [
        { label: "Priced lines", value: String(pricedLines.length) },
        { label: "Direct total", value: currency.format(directTotal) },
      ],
    }),
    section({
      id: "pricing",
      stepId: "offer-step-pricing",
      title: "Pricing",
      issues: [
        customerPrice.selectedContractValueIncGst <= 0 &&
          "No customer price set.",
        customerPrice.needsOverrideReason &&
          "Add the commercial reason for the price override.",
      ]
        .filter((v): v is string => Boolean(v)),
      rows: [
        {
          label: "Fixed price inc GST",
          value: currency.format(customerPrice.selectedContractValueIncGst),
        },
        {
          label: "Computed build-up",
          value: currency.format(customerPrice.computedContractValueIncGst),
        },
      ],
    }),
    section({
      id: "scope",
      stepId: "offer-step-scope",
      title: "Scope",
      issues:
        shownAllowances.length + shownExclusions.length === 0
          ? ["No allowances or exclusions shown on the Offer document."]
          : [],
      rows: [
        { label: "Allowances shown", value: String(shownAllowances.length) },
        { label: "Exclusions shown", value: String(shownExclusions.length) },
      ],
    }),
    section({
      id: "offer-document",
      stepId: "offer-step-offer-document",
      title: "Offer document",
      issues: [
        draft.headline.trim().length === 0 && "Headline",
        draft.introText.trim().length === 0 && "Intro text",
        draft.inclusionBullets.length === 0 && "Inclusion bullets",
      ]
        .filter((v): v is string => Boolean(v))
        .map((field) => `${field} is missing.`),
      rows: [
        { label: "Headline", value: draft.headline || "—" },
        { label: "Inclusions", value: String(draft.inclusionBullets.length) },
        { label: "Exclusions", value: String(draft.exclusionBullets.length) },
      ],
    }),
  ];
}
