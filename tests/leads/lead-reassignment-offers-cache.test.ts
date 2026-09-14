import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Reassigning a lead never expired the cached offers listing, which is scoped
// to the leads a user is assigned. The lead stayed on its old owner's offers
// list, and off its new owner's, until the cache ran out. updateLead lives in a
// "use server" file that loads Prisma, so no test can import it; this reads the
// source instead.
// updateTag would be the wrong fix: updateLead also runs from Route Handlers
// (the lead PATCH, MCP and booking routes), where updateTag throws.

const text = readFileSync(join(process.cwd(), "lib/data/leads.ts"), "utf8");

// A top-level function runs from its signature to the first unindented `}`.
function functionBody(name: string): string {
  const start = text.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in leads.ts`);
  const end = text.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} has no end`);
  return text.slice(start, end);
}

test("updateLead expires the offers listing once the new assignee is written", () => {
  assert.match(text, /import \{[^}]*\brevalidateTag\b[^}]*\} from "next\/cache"/);
  const body = functionBody("updateLead");

  const invalidation = body.search(/revalidateTag\(\s*"offers"/);
  assert.ok(invalidation >= 0, "updateLead never invalidates the offers listing");
  assert.ok(
    body.indexOf("prisma.$transaction(") < invalidation,
    "the listing is expired before the reassignment is written",
  );
  assert.match(body, /if \(assigneeChanged\) \{\s*revalidateTag\(\s*"offers"/);
});

test("the invalidation is keyed off a real change of assignee", () => {
  const body = functionBody("updateLead");
  assert.match(
    body,
    /const assigneeChanged =\s*input\.assignedId !== undefined &&[^;]*existingLead\?\.assignedId/,
  );
});

test("updateLead does not use updateTag, which throws outside a Server Action", () => {
  assert.doesNotMatch(functionBody("updateLead"), /\bupdateTag\(/);
});
