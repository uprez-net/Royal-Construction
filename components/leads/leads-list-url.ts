import { leadStatusSchema } from "@/utils/validators/lead";
import { readLeadListSort, type LeadListSort } from "@/lib/leads/list-sort";

export const LEAD_SORT_OPTIONS: readonly {
  value: LeadListSort;
  label: string;
}[] = [
  { value: "createdAt-desc", label: "Created, newest first" },
  { value: "createdAt-asc", label: "Created, oldest first" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "updatedAt-desc", label: "Updated, newest first" },
  { value: "updatedAt-asc", label: "Updated, oldest first" },
];

/**
 * The shortest search that is applied. The table reads /api/leads, whose
 * `getLeads` (lib/data/leads.ts) runs a case-insensitive `contains` over name,
 * email, phone and address columns with no minimum length of its own, which is
 * cheap at this table's size, so the threshold only exists to skip one- and
 * two-letter queries that match a large share of the table. It used to be 5
 * with no hint, which made "Tom", "Lee" and "Tran" do nothing (#438); 3 lets
 * those through and the box now says when a query is too short.
 */
export const MIN_SEARCH_CHARS = 3;

/**
 * Where the URL's ?query= is going: the query the last search request asked
 * for while that router.replace is still in flight, otherwise the query the URL
 * shows. router.replace takes a round trip and the URL only catches up when it
 * lands, so the shown query alone is stale in between (#465).
 *
 * The request only counts while it is still the latest navigation: a metric
 * card, page or sort change made meanwhile preempts it (Next drops the older
 * one), and judging a clear against a query that was dropped would send a
 * replace built from stale params that wipes the card's filter. The caller
 * counts every navigation it makes; `requestedNavigation` is that count when
 * the search request was made (-1 before any), `latestNavigation` the count now.
 *
 * `history` is the query a browser Back or Forward is taking the URL to, until
 * it lands (#484). Back is not a navigation the caller counts, so it does not
 * make the search request stale by itself: the caller clears `requested` when
 * Back arrives, and the query Back is heading for is the heading until the URL
 * catches up, or the box would re-apply the query Back just left.
 */
export function searchHeading({
  navigating,
  requestedNavigation,
  latestNavigation,
  requested,
  shown,
  history,
}: {
  navigating: boolean;
  requestedNavigation: number;
  latestNavigation: number;
  requested: string | null;
  shown: string;
  history?: string | null;
}): string {
  if (
    navigating
    && requested !== null
    && requestedNavigation === latestNavigation
  ) {
    return requested;
  }
  return history ?? shown;
}

/**
 * The query the Search box should ask the URL for, or null when the URL already
 * shows it or is on its way there. `typed` is the trimmed box value and
 * `heading` comes from searchHeading.
 *
 * Comparing with the shown query alone made "tes" followed by a quick clear
 * read as "nothing to do" (the URL had not caught up yet), and ?query=tes was
 * left applied under an empty box (#465).
 *
 * A query applies at MIN_SEARCH_CHARS. Clearing the box, or cutting an applied
 * "smithx" back to "s", removes it; a short query that was never applied
 * changes nothing (the box says so), and one already in the URL is kept.
 */
export function searchQueryToRequest(
  typed: string,
  heading: string,
): string | null {
  const next =
    typed.length >= MIN_SEARCH_CHARS || typed === heading ? typed : "";
  return next === heading ? null : next;
}

/**
 * The Leads table's place — page and filters — lives in the /leads URL
 * (issue #350), so coming back from a lead lands where the list was, a reload
 * keeps it, and opening Leads fresh from anywhere else starts over:
 *
 *   ?page=4        the table page (absent means 1)
 *   ?query=smith   the applied search (MIN_SEARCH_CHARS or more)
 *   ?status=lost   the metric card or stage chips (comma list of stages)
 *   ?timing=today  the timing filter (absent means "all")
 *   ?sort=name-desc  the sort option (absent means created, newest first)
 */
export const LEADS_LIST_PARAM_KEYS = [
  "page",
  "query",
  "status",
  "timing",
  "sort",
] as const;

type LeadsListParamKey = (typeof LEADS_LIST_PARAM_KEYS)[number];

/** A value to set, or null/empty to remove the parameter. */
export type LeadsListParamChanges = Partial<
  Record<LeadsListParamKey, string | null>
>;

export type LeadsListParams = {
  readonly page: number;
  readonly query: string;
  readonly status: string | null;
  readonly timing: string;
  readonly sort: LeadListSort;
};

type SearchParamsLike = {
  get(name: string): string | null;
  toString(): string;
};

const STATUS_KEYWORDS = ["total", "converted", "pendingFollowup", "lost"];

// The timing select's options. The server reads any other value as "today", so
// an unknown one would filter the table while the select showed nothing.
const TIMING_VALUES = [
  "today",
  "this_week",
  "this_month",
  "quarter",
  "this_year",
  "all",
];

// The metric-card keywords, or a comma list of stages. "Archived" is a chip but
// not a stage, and "Converted" is a retired stage a bookmark may still carry;
// anything else unknown is ignored rather than sent to the API.
function validStatus(value: string | null): string | null {
  if (!value) return null;
  if (STATUS_KEYWORDS.includes(value)) return value;
  const allValid = value.split(",").every((part) => {
    const label = part.trim();
    if (label === "Archived" || label === "Converted") return true;
    return leadStatusSchema.safeParse(label).success;
  });
  return allValid ? value : null;
}

function validTiming(value: string | null): string {
  const timing = value?.trim();
  return timing && TIMING_VALUES.includes(timing) ? timing : "all";
}

/** Read and normalise the lead table's page, filters and sort from its URL. */
export function readLeadsListParams(params: SearchParamsLike): LeadsListParams {
  const page = Number(params.get("page"));
  return {
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    query: params.get("query")?.trim() ?? "",
    status: validStatus(params.get("status")),
    timing: validTiming(params.get("timing")),
    sort: readLeadListSort(params.get("sort")),
  };
}

/** The search string ("?…", or "" when empty) after applying `changes`. */
export function withLeadsListParams(
  current: SearchParamsLike,
  changes: LeadsListParamChanges,
): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const query = next.toString();
  return query ? `?${query}` : "";
}

/**
 * Where "Back to all leads" goes: the list a lead was opened from, carried as
 * the lead page's `?list=`. Only the list's own keys are kept, so the link can
 * never be pointed anywhere but the Leads table.
 */
export function leadsListHref(listQuery: string | null): string {
  if (!listQuery) return "/leads";
  const source = new URLSearchParams(listQuery);
  const kept = new URLSearchParams();
  for (const key of LEADS_LIST_PARAM_KEYS) {
    const value = source.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `/leads?${query}` : "/leads";
}

/** The lead page for `leadId`, remembering the list it was opened from. */
export function leadDetailHref(leadId: number, listQuery: string): string {
  const list = new URLSearchParams(leadsListHref(listQuery).split("?")[1]);
  const query = list.toString();
  return query
    ? `/leads/${leadId}?list=${encodeURIComponent(query)}`
    : `/leads/${leadId}`;
}
