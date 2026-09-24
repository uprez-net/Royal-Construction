import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isUnsafeToLeave,
  type OfferSaveState,
} from "@/lib/offer/workspace-save-state";

// The offer workspace only asked the browser to confirm closing the tab while a
// save was in flight. Once a save had failed, the tab closed silently and the
// unsaved edits were lost.

test("leaving is unsafe while a save is running or after one failed", () => {
  assert.equal(isUnsafeToLeave("saving"), true);
  assert.equal(isUnsafeToLeave("error"), true);
});

test("leaving is safe when nothing is waiting to be saved", () => {
  const safe: readonly OfferSaveState[] = ["idle", "saved", "reconciled"];
  for (const state of safe) {
    assert.equal(isUnsafeToLeave(state), false, state);
  }
});
