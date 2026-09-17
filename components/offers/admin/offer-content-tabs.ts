import type { AdminOfferContentSection } from "@/lib/store/slices/adminOfferContentSlice";

export type AdminOfferTabs =
  | "job-setup"
  | "cost-schedule"
  | "offer-scope"
  | "HBFC-claim"
  | "offer-inclusions"
  | "offer-content";

export const ADMIN_OFFER_TABS: readonly { id: AdminOfferTabs; label: string }[] = [
  { id: "job-setup", label: "Job Setup" },
  { id: "cost-schedule", label: "Cost Schedule" },
  { id: "offer-scope", label: "Scope" },
  { id: "offer-inclusions", label: "Inclusions" },
  { id: "offer-content", label: "Offer Document" },
  { id: "HBFC-claim", label: "HBCF Claim" },
];

// The slice section each tab saves. Inclusions and Offer Document are two
// screens over the one offerContent save, so an edit on either marks both.
export const TAB_SECTION: Readonly<Record<AdminOfferTabs, AdminOfferContentSection>> = {
  "job-setup": "buildScope",
  "cost-schedule": "costSchedule",
  "offer-scope": "offerScope",
  "offer-inclusions": "offerContent",
  "offer-content": "offerContent",
  "HBFC-claim": "hbfcClaim",
};

export function dirtyByTab(
  dirty: Readonly<Record<AdminOfferContentSection, boolean>>,
): Record<AdminOfferTabs, boolean> {
  const byTab = {} as Record<AdminOfferTabs, boolean>;
  for (const { id } of ADMIN_OFFER_TABS) {
    byTab[id] = dirty[TAB_SECTION[id]];
  }
  return byTab;
}

// Stable ids tying each tab to the panel it controls. Derived from the tab id
// rather than written out, because one of them ("HBFC-claim") is mixed case and
// a hand-typed copy would drift.
export const adminTabId = (tab: AdminOfferTabs): string => `admin-offer-tab-${tab}`;
export const adminPanelId = (tab: AdminOfferTabs): string => `admin-offer-panel-${tab}`;
