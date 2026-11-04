import type {
  FinancialActivity,
  FinancialFigures,
} from "@/lib/domain/projects/financial-report";

// The Financials tab's filter, applied to every stage at once. Pure, so the
// stage tables (as TanStack's global filter) and the "showing N of M" count
// read the same answer.
//
// An activity is kept when it matches, when one of its descendants does — so
// the match is reachable — or, for a search, when an ancestor's name does, so
// searching for a parent shows what is under it.

export const FINANCIAL_VIEWS = [
  "all",
  "profit",
  "loss",
  "over",
  "uninvoiced",
] as const;

export type FinancialView = (typeof FINANCIAL_VIEWS)[number];

export const FINANCIAL_VIEW_LABELS: Record<FinancialView, string> = {
  all: "All",
  loss: "Loss",
  over: "Invoiced exceeds quoted",
  profit: "Profit",
  uninvoiced: "Not invoiced",
};

export function isFinancialView(value: string | null): value is FinancialView {
  return (FINANCIAL_VIEWS as readonly (string | null)[]).includes(value);
}

export type FinancialFilter = {
  /** Lower-cased by the reader; matched against names, tradies and numbers. */
  readonly search: string;
  readonly view: FinancialView;
  readonly tradieId: string | null;
};

export const NO_FINANCIAL_FILTER: FinancialFilter = {
  search: "",
  tradieId: null,
  view: "all",
};

export function isFilterActive(filter: FinancialFilter): boolean {
  return (
    filter.search.trim() !== "" || filter.view !== "all" || !!filter.tradieId
  );
}

function viewMatches(figures: FinancialFigures, view: FinancialView): boolean {
  switch (view) {
    case "all":
      return true;
    case "profit":
      return figures.outcome === "PROFIT";
    case "loss":
      return figures.outcome === "LOSS";
    case "over":
      return figures.overInvoiced;
    case "uninvoiced":
      // Work someone is booked for that nobody has billed yet.
      return figures.outcome === "NOT_INVOICED" && figures.quotedCents > 0;
  }
}

/** The activity on its own, ignoring the rest of its tree. */
function selfMatches(
  activity: FinancialActivity,
  filter: FinancialFilter,
  ancestorNames: readonly string[],
): boolean {
  const search = filter.search.trim().toLowerCase();
  if (search) {
    const own = [
      activity.name,
      ...activity.bookings.flatMap((booking) => [
        booking.tradieName,
        booking.trade ?? "",
        ...booking.invoices.map((invoice) => invoice.invoiceNumber ?? ""),
      ]),
      ...ancestorNames,
    ]
      .join(" ")
      .toLowerCase();
    if (!own.includes(search)) return false;
  }
  if (
    filter.tradieId
    && !activity.bookings.some(
      (booking) => booking.tradieId === filter.tradieId,
    )
  ) {
    return false;
  }
  // A leaf is judged on its figures; a parent, on its own bookings, so that
  // "Loss" does not keep a parent only because one child lost money — the
  // child is what is kept, and the parent comes along to reach it.
  const figures = activity.children.length ? activity.own : activity.figures;
  if (
    activity.children.length
    && filter.view !== "all"
    && activity.bookings.length === 0
  ) {
    return false;
  }
  return viewMatches(figures, filter.view);
}

/** Should this activity show under the filter? */
export function activityMatches(
  activity: FinancialActivity,
  filter: FinancialFilter,
  ancestorNames: readonly string[] = [],
): boolean {
  if (!isFilterActive(filter)) return true;
  if (selfMatches(activity, filter, ancestorNames)) return true;
  const path = [...ancestorNames, activity.name];
  return activity.children.some((child) =>
    activityMatches(child, filter, path),
  );
}

/** How many activities, at any depth, the filter shows and how many exist. */
export function countMatches(
  activities: readonly FinancialActivity[],
  filter: FinancialFilter,
): { readonly shown: number; readonly total: number } {
  let shown = 0;
  let total = 0;
  const walk = (
    nodes: readonly FinancialActivity[],
    ancestors: readonly string[],
    visible: boolean,
  ) => {
    for (const node of nodes) {
      total += 1;
      const kept = visible && activityMatches(node, filter, ancestors);
      if (kept) shown += 1;
      walk(node.children, [...ancestors, node.name], kept);
    }
  };
  walk(activities, [], true);
  return { shown, total };
}
