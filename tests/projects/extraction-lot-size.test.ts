import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEmptyProjectExtractionData,
  projectExtractionSchema,
} from "../../types/project-extraction";

// The Create Project review step re-parses the whole extraction object on
// every keystroke (`updateExtractionField` → `projectExtractionSchema.parse`).
// A numeric field must therefore accept what an <input> hands back — a string —
// and coerce it, exactly like every other numeric field in the schema does via
// `nullableNumberField`. `lotSize` was declared as a bare `z.number()`, so the
// first character typed into Lot Size threw a ZodError inside the setState
// updater and took down the whole page.

test("lotSize accepts a typed string and coerces it to a number", () => {
  const empty = createEmptyProjectExtractionData();
  const parsed = projectExtractionSchema.parse({ ...empty, lotSize: "450" });
  assert.equal(parsed.lotSize, 450);
});

test("lotSize treats a cleared input as null, not a crash", () => {
  const empty = createEmptyProjectExtractionData();
  assert.equal(
    projectExtractionSchema.parse({ ...empty, lotSize: "" }).lotSize,
    null,
  );
  assert.equal(
    projectExtractionSchema.parse({ ...empty, lotSize: "abc" }).lotSize,
    null,
  );
});

test("lotSize still accepts a real number from the extraction agent", () => {
  const empty = createEmptyProjectExtractionData();
  assert.equal(
    projectExtractionSchema.parse({ ...empty, lotSize: 612.5 }).lotSize,
    612.5,
  );
  assert.equal(
    projectExtractionSchema.parse({ ...empty, lotSize: null }).lotSize,
    null,
  );
});
