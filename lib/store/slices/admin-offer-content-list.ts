// Kept free of the slice and its server actions so it can be tested without
// loading Prisma.

// Puts a removed item back where it was. Admin deletes offer Undo, and the
// restored item must land in its old slot: cost rows are grouped into phases by
// their order, so appending would move a task to the end of its phase. An index
// the list no longer reaches, because other items went meanwhile, appends.
export function insertAt<T>(items: readonly T[], item: T, index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    return [...items, item];
  }
  return [...items.slice(0, index), item, ...items.slice(index)];
}
