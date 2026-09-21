import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { resolveAdminGuard } from "../../lib/auth/require-admin";

// The five admin offer-content Server Actions had no authorization of any kind.
// The only gate was proxy.ts:84, which matches request.nextUrl.pathname against
// /admin(.*) — a navigation guard. A Server Action POSTs to whatever URL the
// browser is on, so invoked from a non-admin path the role check never ran.
// Verified against the running app: an admin save posted to /dashboard reaches
// the action and executes.
//
// The refusal branches cannot be exercised by signing in on staging, because
// every user in that database is an ADMIN. That is why the decision is a pure
// function.

const ADMIN = { id: "user-1", role: "ADMIN" };

test("an ADMIN is allowed, and carries their internal id", () => {
  const guard = resolveAdminGuard("clerk_abc", ADMIN);
  assert.equal(guard.ok, true);
  assert.equal(guard.ok && guard.userId, "user-1");
});

test("an authenticated non-admin is refused", () => {
  // The population the middleware bypass actually exposed: signed-in staff who
  // are not admins. Every role that is not exactly ADMIN must be refused.
  for (const role of ["SALES", "SITE_MANAGER", "TRADIE", "CUSTOMER", "GUEST"]) {
    const guard = resolveAdminGuard("clerk_abc", { id: "user-2", role });
    assert.equal(guard.ok, false, `${role} was allowed through`);
  }
});

test("a signed-in account with no internal user is refused", () => {
  assert.equal(resolveAdminGuard("clerk_abc", null).ok, false);
});

test("no session is refused", () => {
  for (const clerkId of [null, undefined, ""]) {
    assert.equal(
      resolveAdminGuard(clerkId, ADMIN).ok,
      false,
      `${clerkId} allowed`,
    );
  }
});

test("the role comparison is exact, not a prefix or case-insensitive match", () => {
  for (const role of [
    "admin",
    "Admin",
    "ADMINISTRATOR",
    "NOT_ADMIN",
    " ADMIN",
  ]) {
    const guard = resolveAdminGuard("clerk_abc", { id: "user-3", role });
    assert.equal(guard.ok, false, `"${role}" was treated as ADMIN`);
  }
});

test("refusing a non-admin says no more than refusing a stranger", () => {
  // A non-admin should not learn from the error that the resource exists and is
  // admin-only.
  const noSession = resolveAdminGuard(null, null);
  const wrongRole = resolveAdminGuard("clerk_abc", { id: "u", role: "SALES" });
  assert.equal(noSession.ok, false);
  assert.equal(wrongRole.ok, false);
  assert.equal(
    noSession.ok === false && wrongRole.ok === false
      ? noSession.error === wrongRole.error
      : false,
    true,
    "the two refusals are distinguishable",
  );
});

// Guarding the actions was not enough on its own. The writers they call were
// exported from lib/data/admin-offer-content.ts, which is "use server", and every
// exported async function in such a module is its own Server Action. So
// updateBuildScope and the rest stayed callable directly, with no guard,
// skipping the actions entirely. They now live in a module with no directive.

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

// A directive only counts as the first statement, so skip leading comments.
function startsWithUseServer(text: string): boolean {
  const body = text.replace(
    /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/,
    "",
  );
  return /^["']use server["']/.test(body);
}

test("the 'use server' admin data module exports only the cached read", () => {
  const text = source("lib/data/admin-offer-content.ts");
  assert.equal(startsWithUseServer(text), true);
  assert.doesNotMatch(text, /export\s+async\s+function\s+update/);
  // A re-export makes a writer a Server Action just as surely, and the name
  // list below cannot see one.
  assert.doesNotMatch(text, /export\s*(?:\{|\*|default\b)/);
  const exported = [
    ...text.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g),
  ].map((match) => match[1]);
  assert.deepEqual(exported, ["getAdminOfferContent"]);
});

test("the admin writers live in a module that is not 'use server'", () => {
  const text = source("lib/data/admin-offer-content-writes.ts");
  assert.equal(startsWithUseServer(text), false);
  for (const writer of [
    "updateBuildScope",
    "updateCostSchedule",
    "updateOfferScope",
    "updateOfferContent",
    "updateHBCFClaim",
  ]) {
    assert.match(text, new RegExp(`export async function ${writer}\\b`));
  }
});

test("the directive check itself sees a directive behind leading comments", () => {
  assert.equal(
    startsWithUseServer('// note\n/* block */\n"use server";\n'),
    true,
  );
  assert.equal(startsWithUseServer("'use server';"), true);
  assert.equal(
    startsWithUseServer('// "use server" in a comment\nimport x from "y";'),
    false,
  );
});
