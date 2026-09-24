import { leadStatusSchema } from "@/utils/validators/lead";

/**
 * The Leads table's place — page and filters — lives in the /leads URL
 * (issue #350), so coming back from a lead lands where the list was, a reload
 * keeps it, and opening Leads fresh from anywhere else starts over:
 *
 *   ?page=4        the table page (absent means 1)
 *   ?query=smith   the applied search (five characters or more)
 *   ?status=lost   the metric card or stage chips (comma list of stages)
 *   ?timing=today  the timing filter (absent means "all")
 */
export const LEADS_LIST_PARAM_KEYS = [
  "page",
  "query",
  "status",
  "timing",
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

export function readLeadsListParams(params: SearchParamsLike): LeadsListParams {
  const page = Number(params.get("page"));
  return {
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    query: params.get("query")?.trim() ?? "",
    status: validStatus(params.get("status")),
    timing: validTiming(params.get("timing")),
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
