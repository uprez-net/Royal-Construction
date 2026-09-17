import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// The store outlives the editor, so unsaved admin edits survive navigating away.
// The beforeunload guard used to mount with SaveChangesButton, which meant it
// unmounted on the way out and a later reload lost those edits in silence.

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the guard is mounted above every route, by the Redux provider", () => {
  const provider = read("components/providers/redux-provider.tsx");
  assert.match(provider, /<UnsavedAdminGuard \/>/);
  assert.match(provider, /use-unsaved-admin-guard/);
});

test("the Save button no longer owns the guard", () => {
  const button = read("components/offers/admin/shared/save-changes-button.tsx");
  assert.doesNotMatch(button, /useUnsavedAdminGuard/);
});
