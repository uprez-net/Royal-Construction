import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// Issue #481. Radix returns focus on close only to a DialogTrigger, and the
// modal manager opens dialogs from redux state with no trigger, so Escape left
// focus on <body>. The shared DialogContent remembers the last focus outside any
// dialog or menu and, after Radix's own return has run, focuses it if focus was
// left on nothing. No DOM is available here, so this pins the wiring; the
// browser check is in the PR.

const source = readFileSync(
  join(REPO_ROOT, "components/ui/dialog.tsx"),
  "utf8",
);

test("the dialog wrapper tracks focus outside dialogs and menus, and forgets it on a focus-out to nothing", () => {
  assert.match(
    source,
    /closest\('\[role="dialog"\], \[role="alertdialog"\], \[role="menu"\]'\)[\s\S]*?"focusin",[\s\S]*?outside\(event\.target\)/,
  );
  assert.match(
    source,
    /"focusout",[\s\S]*?event\.relatedTarget === null\s*\)\s*\{\s*lastFocusOutsideDialog = null;/,
  );
});

test("the close handler lets Radix return focus first, then restores the opener only if focus ended on body", () => {
  assert.match(
    source,
    /onCloseAutoFocus\?\.\(event\);\s*if \(event\.defaultPrevented\) return;[\s\S]*?queueMicrotask\(\(\) => \{[\s\S]*?opener\?\.isConnected[\s\S]*?active === document\.body[\s\S]*?opener\.focus\(\);/,
  );
});
