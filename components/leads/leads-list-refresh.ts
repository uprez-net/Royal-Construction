import type { LeadListParams } from "@/hooks/use-leads-data";

export type LeadListView = {
  activeTab: "table" | "followups" | "analytics";
  tableParams: LeadListParams;
  settleTablePage: (page: number | null) => void;
};

type LeadListLoader = (params: LeadListParams) => Promise<number | null>;

/** Reload the visible lead cohort; Tasks always starts with open work on page 1. */
export async function reloadLeadList(view: LeadListView, load: LeadListLoader) {
  if (view.activeTab === "followups") {
    await load({ page: 1, limit: 50, hasOpenTask: true });
  } else {
    await load(view.tableParams).then(view.settleTablePage);
  }
}

/** Wait for the edit and stats, then refresh the current view rather than the edit's original view. */
export async function updateAndRefreshLeadList(
  update: () => Promise<boolean>,
  currentView: () => LeadListView,
  refresh: LeadListLoader,
): Promise<boolean> {
  const updated = await update();
  const view = currentView();
  if (view.activeTab !== "analytics") await reloadLeadList(view, refresh);
  return updated;
}
