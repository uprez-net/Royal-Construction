// Browser-safe sort values shared by the controls and transport validation.
export const LEAD_LIST_SORT_VALUES = [
  "createdAt-desc",
  "createdAt-asc",
  "name-asc",
  "name-desc",
  "updatedAt-desc",
  "updatedAt-asc",
] as const;

export type LeadListSort = (typeof LEAD_LIST_SORT_VALUES)[number];

/** Return a recognised sort value, using the caller's default for absent or invalid input. */
export function readLeadListSort(
  value: string | null | undefined,
  fallback: LeadListSort = "createdAt-desc",
): LeadListSort {
  return LEAD_LIST_SORT_VALUES.find((sort) => sort === value) ?? fallback;
}
