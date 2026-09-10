import assert from "node:assert/strict";
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
    assert.equal(resolveAdminGuard(clerkId, ADMIN).ok, false, `${clerkId} allowed`);
  }
});

test("the role comparison is exact, not a prefix or case-insensitive match", () => {
  for (const role of ["admin", "Admin", "ADMINISTRATOR", "NOT_ADMIN", " ADMIN"]) {
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
