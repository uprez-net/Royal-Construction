import assert from "node:assert/strict";
import { test } from "vitest";

import { insertAt } from "@/lib/store/slices/admin-offer-content-list";

// Deleting a cost schedule task, allowance, exclusion or bullet in the admin
// offer-content editors was immediate and silent, with no way back short of
// retyping it. Deletes now offer Undo, which must return the item to the exact
// position it was removed from.

test("insertAt places the item at the index", () => {
  assert.deepEqual(insertAt(["a", "c"], "b", 1), ["a", "b", "c"]);
});

test("an index the list no longer reaches appends", () => {
  assert.deepEqual(insertAt(["a"], "b", 5), ["a", "b"]);
  assert.deepEqual(insertAt(["a"], "b", -1), ["a", "b"]);
});

test("remove then restore at the same index keeps the original order", () => {
  const items = ["a", "b", "c", "d"];
  for (const target of items) {
    const index = items.indexOf(target);
    const removed = items.filter((item) => item !== target);
    assert.deepEqual(
      insertAt(removed, target, index),
      items,
      `restoring ${target}`,
    );
  }
});
