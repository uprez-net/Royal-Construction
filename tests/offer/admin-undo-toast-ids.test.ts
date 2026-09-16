import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import * as ids from "../../components/offers/admin/shared/undo-toast-ids";

// Two pending Undo toasts in one list restored their rows against a list that
// had already changed, so the rows came back in the wrong order. Each list now
// re-uses one toast id, which replaces the toast on screen instead of stacking.

test("every list has its own Undo toast id", () => {
  const values = Object.values(ids);
  assert.equal(new Set(values).size, values.length, "two lists share an Undo toast id");
  assert.equal(values.length, 6);
});

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("every removal toast passes an id", () => {
  const sources = [
    "components/offers/admin/cost-schedule-screen.tsx",
    "components/offers/admin/offer-scope-page.tsx",
    "components/offers/admin/shared/inclusion-schedule-editor.tsx",
    "components/offers/admin/shared/bullet-list-editor.tsx",
  ];
  for (const path of sources) {
    const source = read(path);
    for (const match of source.matchAll(/toast\("[^"]*removed"[^]*?\n\s*\}\);/g)) {
      assert.match(match[0], /\n\s*id: /, `${path}: a removal toast has no id`);
    }
  }
});

test("both bullet lists are given distinct ids", () => {
  const page = read("components/offers/admin/offer-content-page.tsx");
  assert.match(page, /undoToastId=\{INCLUSION_BULLET_UNDO_TOAST_ID\}/);
  assert.match(page, /undoToastId=\{EXCLUSION_BULLET_UNDO_TOAST_ID\}/);
});
