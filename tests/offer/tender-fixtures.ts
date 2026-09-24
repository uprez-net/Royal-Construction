// Shared fixtures for the tender parity suites.
//
// NOT a *.test.ts file on purpose: the runner collects tests/**/*.test.ts, so
// this module is imported rather than executed. It exists because the parity
// assertions are split across two files — offer-tender-template-parity (pure
// HTML, runs in CI) and offer-tender-print-parity (launches Chromium, in the
// `print` project) — and both need the same owner/schedule configurations.
// Keeping one copy stops the two suites drifting onto different fixtures and
// quietly asserting against different documents.

import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildTenderHtml } from "@/lib/offer/offer-tender-html";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import {
  createCompanyOwner,
  createIndividualOwner,
  createOfferSignatory,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferInclusionEntry,
  type OfferOwner,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";

export function snapshotOf(
  owners: OfferOwner[],
  schedule?: readonly OfferInclusionEntry[],
): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB, owners },
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: schedule
      ? { ...INITIAL_OFFER_DRAFT, inclusionSchedule: schedule }
      : INITIAL_OFFER_DRAFT,
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: 0,
    areaCalculator: INITIAL_AREA_CALCULATOR,
    workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    rateCardProduct: "DOUBLE_STOREY",
    rateCardTier: "MID",
    overrideReason: "",
    selectedPriceInput: "",
    standardPriceInput: "",
    priceAdjustmentLabel: "",
    images: EMPTY_OFFER_IMAGES,
  } as unknown as OfferWorkspaceSnapshot;
}

export function individualOwner(index: number): OfferOwner {
  const base = createIndividualOwner(`owner-${index}`);
  return {
    ...base,
    displayName: `Owner Number ${index}`,
    currentLocation: `${index} Somewhat Long Street Name, Sydney NSW 2000`,
    signatories: [
      {
        ...base.signatories[0],
        name: `Owner Number ${index}`,
        email: `owner${index}@example.com`,
        phone: "0400 000 000",
      },
    ],
  };
}

export function companyOwner(index: number, directors: number): OfferOwner {
  const base = createCompanyOwner(`company-${index}`);
  return {
    ...base,
    displayName: `Kensington Grove Property No ${index} Pty Ltd`,
    abn: `12 345 678 ${String(900 + index).slice(0, 3)}`,
    currentLocation: `Level ${index}, 100 Somewhat Long Street, Sydney NSW 2000`,
    signatories: Array.from({ length: directors }, (_, d) => ({
      ...createOfferSignatory(`company-${index}-dir-${d}`, "Director"),
      name: `Director Number ${d + 1} of Company ${index}`,
      email: `dir${d + 1}.co${index}@example.com`,
      phone: "0400 000 000",
    })),
  };
}

export function scheduleOf(n: number): OfferInclusionEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    category: `Trade Label ${i + 1}`,
    spec: `Specification detail for row ${i + 1}. Supply and install in accordance with the approved plans.`,
  }));
}

export function tenderFor(
  owners: OfferOwner[],
  schedule?: readonly OfferInclusionEntry[],
): string {
  return buildTenderHtml(buildProposalInput(snapshotOf(owners, schedule)));
}

export function declaredPageTotal(html: string): number {
  const match = html.match(/Page \d+ of (\d+)/);
  if (!match) throw new Error("document declares no page total");
  return Number(match[1]);
}
