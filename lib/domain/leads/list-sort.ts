import type { Prisma } from "@prisma/client";
import { readLeadListSort, type LeadListSort } from "@/lib/leads/list-sort";

/** Order Lead rows for both listings, with an ID tie-breaker for stable pagination. */
export function leadListOrderBy(
  sort: LeadListSort = "createdAt-desc",
): Prisma.LeadOrderByWithRelationInput[] {
  const safeSort = readLeadListSort(sort);
  const direction = safeSort.endsWith("-asc") ? "asc" : "desc";
  const field = safeSort.split("-")[0];
  return [{ [field]: direction }, { id: direction }];
}
