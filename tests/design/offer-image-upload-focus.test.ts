import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

// The image slots' Upload and Replace controls are a <label> around an sr-only
// file input. The input takes keyboard focus but is invisible, and the label had
// no focus style, so tabbing onto it showed nothing. The label now draws the
// admin tab strip's ring (2px gold ink, offset) while its input has focus.

const source = readFileSync(
  join(
    process.cwd(),
    "components/offers/new-workflow/offer-workspace-images.tsx",
  ),
  "utf8",
);
const adminTabs = readFileSync(
  join(process.cwd(), "components/offers/admin/offer-content-header.tsx"),
  "utf8",
);

test("the upload label shows a focus ring while its hidden input has focus", () => {
  const label = source.match(
    /<label className="([^"]*)">\s*\{url \? "Replace" : "Upload"\}\s*<input[\s\S]*?className="sr-only"/,
  )?.[1];
  assert.ok(label, "no label wraps the sr-only upload input");
  const classes = label.split(/\s+/);

  for (const name of [
    "has-[:focus-visible]:outline-2",
    "has-[:focus-visible]:outline-offset-2",
    "has-[:focus-visible]:outline-royal-gold-ink",
  ]) {
    assert.ok(classes.includes(name), `the upload label is missing ${name}`);
  }
});

test("the ring is the admin tab strip's", () => {
  assert.match(
    adminTabs,
    /focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-gold-ink/,
  );
});
