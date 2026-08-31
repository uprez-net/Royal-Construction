"use client";

import type { OfferAreaCalculator } from "@/lib/offer/workspace-area";
import type {
  OfferDocumentDraft,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
  OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type {
  EffectiveMargin,
  OfferCustomerPrice,
  OfferWorkspacePricing,
  OfferWorkspacePricingSettings,
} from "@/lib/offer/workspace-pricing";

/**
 * Everything the offers tools read and call, in one bag.
 *
 * The tool factories are plain functions of this, with no React in them, so the
 * whole write surface is unit-testable without a browser — which matters more
 * here than usual, because the e2e suite deliberately performs no destructive
 * writes and a workspace write is autosaved against a real offer within a
 * second.
 *
 * Read fields are snapshots of the current render. That is safe because
 * `useWebMcpTools` holds the execute callbacks in a ref and re-reads them on
 * every call, so a tool built this render is invoked with this render's values.
 */
export type OfferToolDeps = {
  // ── Identity and lifecycle ──
  readonly leadId: number | undefined;
  readonly status: OfferWorkspaceStatus;
  readonly reference: string;
  readonly revision: string;
  readonly stateVersion: number;
  /** "idle" | "saving" | "saved" | "error" — writes are persisted by autosave. */
  readonly saveState: string;

  // ── Section state ──
  readonly job: OfferWorkspaceJob;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly draft: OfferDocumentDraft;
  readonly areaCalculator: OfferAreaCalculator;
  readonly pricingSettings: OfferWorkspacePricingSettings;

  // ── Derived, never writable ──
  readonly pricing: OfferWorkspacePricing;
  readonly customerPrice: OfferCustomerPrice;
  readonly directTotal: number;
  readonly totalAreaSqm: number;
  readonly effectiveMargin: EffectiveMargin;

  // ── Pricing decision inputs (strings, as the inputs hold them) ──
  readonly selectedPriceInput: string;
  readonly standardPriceInput: string;
  readonly priceAdjustmentLabel: string;
  readonly overrideReason: string;

  // ── Mutators: the same functions a keystroke calls ──
  readonly updateJob: (patch: Partial<OfferWorkspaceJob>) => void;
  readonly updateLine: (id: string, patch: Partial<OfferWorkspaceCostLine>) => void;
  readonly addLine: () => void;
  readonly removeLine: (id: string) => void;
  readonly updateAreaCalculator: (patch: Partial<OfferAreaCalculator>) => void;
  readonly updatePricingSettings: (
    patch: Partial<OfferWorkspacePricingSettings>,
  ) => void;
  readonly updateAllowance: (id: string, patch: Partial<OfferWorkspaceScopeItem>) => void;
  readonly updateExclusion: (id: string, patch: Partial<OfferWorkspaceScopeItem>) => void;
  readonly addAllowance: () => void;
  readonly addExclusion: () => void;
  readonly removeAllowance: (id: string) => void;
  readonly removeExclusion: (id: string) => void;
  readonly updateDraft: (patch: Partial<OfferDocumentDraft>) => void;
  readonly setSelectedPriceInput: (value: string) => void;
  readonly setStandardPriceInput: (value: string) => void;
  readonly setPriceAdjustmentLabel: (value: string) => void;
  readonly setOverrideReason: (value: string) => void;

  // ── UI ──
  readonly setSectionOpen: (anchorId: string, open: boolean) => void;
  readonly scrollToSection: (anchorId: string) => void;
  readonly prefillFromLead: () => Promise<{ ok: boolean; message: string }>;
};
