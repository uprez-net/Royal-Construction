import assert from "node:assert/strict";
import { test } from "vitest";

import {
  INCLUSION_CATEGORY_SUGGESTIONS,
  normaliseScheduleRows,
} from "@/components/offers/admin/shared/inclusion-schedule";
import { offerContentDataSchema } from "@/lib/validations/admin-offer-content";

// The admin Inclusions tab edited its {spec, category} rows with the plain
// bullet editor. Its draft was a string, so "Add bullet" pushed a bare string
// into inclusionSchedule and the category axis was lost. The save schema
// rejects a string row, and the Inclusions and Offer Document tabs share one
// save, so after adding a single row no offer-content save could succeed.

function contentWith(inclusionSchedule: unknown[]) {
  return {
    headline: "",
    introText: "",
    inclusions: [],
    exclusions: [],
    inclusionSchedule,
    termsAndConditions: "",
  };
}

test("a bare string row becomes {spec}; a categorised row keeps its category", () => {
  assert.deepEqual(
    normaliseScheduleRows([
      "New row",
      {
        spec: "Slab",
        category: "Concrete Slab",
        tenderText: "Tender slab detail",
      },
    ]),
    [
      { spec: "New row" },
      {
        spec: "Slab",
        category: "Concrete Slab",
        tenderText: "Tender slab detail",
      },
    ],
  );
});

test("the save schema accepts normalised rows and rejects the raw string", () => {
  const raw = ["New row", { spec: "Slab", category: "Concrete Slab" }];

  assert.equal(
    offerContentDataSchema.safeParse(contentWith(normaliseScheduleRows(raw)))
      .success,
    true,
  );
  assert.equal(
    offerContentDataSchema.safeParse(contentWith(raw)).success,
    false,
  );
});

test("category suggestions are the standard schedule's distinct labels", () => {
  assert.ok(INCLUSION_CATEGORY_SUGGESTIONS.includes("Concrete Slab"));
  assert.equal(
    new Set(INCLUSION_CATEGORY_SUGGESTIONS).size,
    INCLUSION_CATEGORY_SUGGESTIONS.length,
  );
});
