import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { ContactPicker } from "@/components/modals/compliance/contact-picker";
import { DeveloperPicker } from "@/components/modals/compliance/developer-picker";

import { REPO_ROOT } from "../support/repo-root";

// Issue #457. The certifier and connect-party modals labelled their pickers
// with <Label htmlFor="..."> but the pickers took no id, so the label pointed
// at nothing: the name was covered by an aria-label, but clicking the label did
// not focus the picker. The picker now puts `id` on its trigger.

test("ContactPicker puts its id on the combobox trigger", () => {
  const html = renderToStaticMarkup(
    createElement(ContactPicker, {
      id: "certifier-contact",
      trade: "Certifier",
      label: "Certifier",
      value: null,
      onChange: () => undefined,
    }),
  );
  assert.match(
    html,
    /<button[^>]*\sid="certifier-contact"[^>]*role="combobox"/,
  );
});

test("DeveloperPicker puts its id on the combobox trigger", () => {
  const html = renderToStaticMarkup(
    createElement(DeveloperPicker, {
      id: "party-contact",
      value: null,
      onChange: () => undefined,
    }),
  );
  assert.match(html, /<button[^>]*\sid="party-contact"[^>]*role="combobox"/);
});

for (const [file, ids] of [
  [
    "components/modals/start-certifier-engagement-modal.tsx",
    ["certifier-contact"],
  ],
  ["components/modals/compliance/connect-party-modal.tsx", ["party-contact"]],
] as const) {
  test(`${file}: each picker label's htmlFor is the id given to the picker`, () => {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const id of ids) {
      assert.ok(source.includes(`htmlFor="${id}"`), `no Label for ${id}`);
      assert.ok(source.includes(`id="${id}"`), `no picker with id ${id}`);
    }
  });
}
