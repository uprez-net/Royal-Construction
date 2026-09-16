import type { InclusionScheduleRow } from "@/types/admin-offer-content";
import { STANDARD_INCLUSION_ENTRIES } from "@/lib/offer/workspace-proposal-content";

// The schedule used to share the plain bullet editor, whose draft is a string,
// so an added row landed in state as a bare string. The save schema only takes
// {spec, category?}, and the Inclusions and Offer Document tabs share one save,
// so a single added row made every offer-content save fail. Rows are
// normalised at the dispatch boundary so that shape can never reach the slice.
export function normaliseScheduleRows(
  rows: readonly (string | InclusionScheduleRow)[],
): InclusionScheduleRow[] {
  return rows.map((row) => {
    if (typeof row === "string") return { spec: row };
    return row.category === undefined
      ? { spec: row.spec }
      : { spec: row.spec, category: row.category };
  });
}

// The standard schedule's own trade labels. The tender's section map is written
// against these, so offering them keeps an admin row out of "Other Inclusions"
// unless the admin deliberately types a label of their own.
export const INCLUSION_CATEGORY_SUGGESTIONS: readonly string[] = Array.from(
  new Set(
    STANDARD_INCLUSION_ENTRIES.map((entry) => entry.category?.trim() ?? "").filter(
      (category) => category !== "",
    ),
  ),
);
