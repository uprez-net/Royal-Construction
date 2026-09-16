import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// That updateLead expires the "offers" listing, and does so for every update
// that sets an assignee, is asserted by tests/offer/offer-listing-view.test.ts,
// which owns those rules. This file keeps the one thing that test does not say:
// WHICH invalidation call is safe here.
//
// updateTag would be the wrong fix. updateLead also runs from Route Handlers —
// the lead PATCH, MCP and booking routes — and updateTag throws outside a Server
// Action, so it would turn a cache refresh into a failed save.

const text = readFileSync(join(process.cwd(), "lib/data/leads.ts"), "utf8");

function functionBody(name: string): string {
  const start = text.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in leads.ts`);
  const end = text.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} has no end`);
  return text.slice(start, end);
}

test("updateLead does not use updateTag, which throws outside a Server Action", () => {
  assert.doesNotMatch(functionBody("updateLead"), /\bupdateTag\(/);
});

test("the expiry cannot fail the save", () => {
  const body = functionBody("updateLead");
  const at = body.search(/revalidateTag\(\s*"offers"/);
  assert.ok(at >= 0, "updateLead never expires the offers listing");
  assert.match(
    body.slice(Math.max(0, at - 200), at + 200),
    /try \{[\s\S]*revalidateTag\(\s*"offers"[\s\S]*catch/,
    "the expiry is not guarded, so a cache failure would fail the lead save",
  );
});
