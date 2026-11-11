import type { Prisma } from "@prisma/client";
import { readLeadListSort, type LeadListSort } from "@/lib/leads/list-sort";

// Both lists page Lead rows (Offers groups its revisions by lead). Keep the
// allowed columns and deterministic tie-breaker in one place.
export function leadListOrderBy(
  sort: LeadListSort = "createdAt-desc",
): Prisma.LeadOrderByWithRelationInput[] {
  const safeSort = readLeadListSort(sort);
  const direction = safeSort.endsWith("-asc") ? "asc" : "desc";
  const field = safeSort.split("-")[0];
  return [{ [field]: direction }, { id: direction }];
}
