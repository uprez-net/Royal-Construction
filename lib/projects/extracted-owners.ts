// Combining the owners each extraction chunk found into one list.
//
// The tender and contract are read in chunks, and every chunk answers the
// whole schema. Only one of them holds the contract's WHO section — the first,
// since it opens the contract — but every later chunk still answers
// `legalAdministrationOwners`, usually from the signature block or a footer
// where the parties it can see are the builder and a witness. A plain
// "last non-empty answer wins" merge let that later guess replace the real
// owners. So the first chunk that names owners decides who they are, and a
// later chunk can only fill in a detail that chunk left blank on an owner of
// the same name.

import type { ProjectExtractionOwner } from "@/types/project-extraction";

const OWNER_FIELDS = ["name", "email", "phone", "address"] as const;

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isBlank(owner: ProjectExtractionOwner): boolean {
  return OWNER_FIELDS.every((field) => !owner[field].trim());
}

/**
 * The owners so far, with what `next` adds.
 *
 * - Nothing found yet: `next` is the list.
 * - Owners already found: the list and its order stay; a `next` owner of the
 *   same name fills only the details still blank. A name not already on the
 *   list is not added — it is the later chunk guessing, and an owner who
 *   should be there is one row for the operator to add, where a wrong one
 *   becomes a customer.
 */
export function mergeExtractedOwners(
  current: readonly ProjectExtractionOwner[],
  next: readonly ProjectExtractionOwner[],
): ProjectExtractionOwner[] {
  const found = current.filter((owner) => !isBlank(owner));
  const incoming = next.filter((owner) => !isBlank(owner));

  if (found.length === 0) return [...incoming];

  return found.map((owner) => {
    const key = nameKey(owner.name);
    const match = key
      ? incoming.find((candidate) => nameKey(candidate.name) === key)
      : undefined;
    if (!match) return owner;

    const filled = { ...owner };
    for (const field of OWNER_FIELDS) {
      if (!filled[field].trim() && match[field].trim()) {
        filled[field] = match[field];
      }
    }
    return filled;
  });
}
