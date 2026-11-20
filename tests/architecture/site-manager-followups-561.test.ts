import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Role } from "@prisma/client";
import { test } from "vitest";

import { clerkRoleToStore } from "@/lib/domain/identity/team";
import {
  INTERNAL_ROLES,
  isInternalRole,
  isOfficePrincipal,
  isOfficeRole,
  userPrincipal,
} from "@/lib/domain/principal";
import { REPO_ROOT } from "../support/repo-root";
import { recordingDb } from "./domain-harness";

// Issue #561. GUEST is "Access pending": an account nobody has approved. It is
// not staff and not office, and a role set in the Clerk dashboard reaches the
// database only through the same hand-over and last-admin rules as the team
// screen.

/* ------------------------------------------------------ GUEST is no staff -- */

test("GUEST is neither internal staff nor office", () => {
  assert.equal(INTERNAL_ROLES.includes(Role.GUEST), false);
  assert.equal(isInternalRole(Role.GUEST), false);
  assert.equal(isOfficeRole(Role.GUEST), false);
  assert.equal(
    isOfficePrincipal(userPrincipal({ id: "g", role: Role.GUEST })),
    false,
  );
});

test("admins and site managers keep their current staff and office answers", () => {
  assert.equal(isInternalRole(Role.ADMIN), true);
  assert.equal(isOfficeRole(Role.ADMIN), true);
  assert.equal(isInternalRole(Role.SITE_MANAGER), true);
  assert.equal(isOfficeRole(Role.SITE_MANAGER), false);
});

/* ---------------------------------------- the Clerk webhook's role write -- */

// The scripted reads for a stored ADMIN who holds leads, with two admins in the
// business so the last-admin guard does not decide first.
const holdsLeads = {
  "leadTask.count": 0,
  "lead.count": 2,
  "user.count": 2,
};

test("a dashboard role change refused for someone holding leads keeps the stored role", async () => {
  const recorder = recordingDb({
    ...holdsLeads,
    "user.findUnique": { id: "u_1", name: "Sam", role: "ADMIN" },
  });

  const decision = await clerkRoleToStore(
    { clerkRole: Role.SITE_MANAGER, clerkUserId: "clerk_1" },
    recorder.db,
  );

  assert.deepEqual(decision, { refusedRole: Role.ADMIN, write: undefined });
  assert.deepEqual(recorder.writes(), []);
});

test("a dashboard demotion of the last admin is refused", async () => {
  const recorder = recordingDb({
    "user.count": 1,
    "user.findUnique": { id: "u_1", name: "Sole", role: "ADMIN" },
  });

  const decision = await clerkRoleToStore(
    { clerkRole: Role.GUEST, clerkUserId: "clerk_1" },
    recorder.db,
  );

  assert.deepEqual(decision, { refusedRole: Role.ADMIN, write: undefined });
  assert.deepEqual(recorder.writes(), []);
});

test("an echo of the stored role is a no-op: no count, no write, no write-back", async () => {
  // The write-back puts the stored role into Clerk; its user.updated echo
  // carries that same role, which must not start another round trip.
  const recorder = recordingDb({
    "user.findUnique": { id: "u_1", name: "Sam", role: "SITE_MANAGER" },
  });

  const decision = await clerkRoleToStore(
    { clerkRole: Role.SITE_MANAGER, clerkUserId: "clerk_1" },
    recorder.db,
  );

  assert.deepEqual(decision, { refusedRole: null, write: Role.SITE_MANAGER });
  assert.deepEqual(recorder.operations(), ["user.findUnique"]);
});

test("a change the rules allow is stored", async () => {
  // GUEST holds no office work, so moving it to site manager hands over nothing.
  const recorder = recordingDb({
    "user.findUnique": { id: "u_1", name: "New", role: "GUEST" },
  });

  const decision = await clerkRoleToStore(
    { clerkRole: Role.SITE_MANAGER, clerkUserId: "clerk_1" },
    recorder.db,
  );

  assert.deepEqual(decision, { refusedRole: null, write: Role.SITE_MANAGER });
  assert.equal(recorder.writes().length, 0);
});

test("no role in Clerk, or no local row yet, leaves the behaviour as it was", async () => {
  const none = recordingDb();
  assert.deepEqual(
    await clerkRoleToStore(
      { clerkRole: undefined, clerkUserId: "clerk_1" },
      none.db,
    ),
    { refusedRole: null, write: undefined },
  );
  assert.deepEqual(none.operations(), []);

  const missing = recordingDb({ "user.findUnique": null });
  assert.deepEqual(
    await clerkRoleToStore(
      { clerkRole: Role.SITE_MANAGER, clerkUserId: "clerk_new" },
      missing.db,
    ),
    { refusedRole: null, write: Role.SITE_MANAGER },
  );
});

test("the webhook writes the decided role and sets a refused one back to Clerk", () => {
  // Source-level, like the other webhook pins: the route has no seam for a
  // Clerk client, so this checks the wiring the decision above depends on.
  const route = readFileSync(
    join(REPO_ROOT, "app/api/webhook/clerk/route.ts"),
    "utf8",
  );
  assert.match(route, /clerkRoleToStore\(/);
  assert.match(route, /const role = roleDecision\.write;/);
  assert.match(
    route,
    /updateUserMetadata\(updatedId, \{\s*publicMetadata: \{ role: roleDecision\.refusedRole \}/,
  );
  // Staging shares the Clerk instance: only production writes back.
  assert.match(
    route,
    /const writesBack =\s*notificationEnvironment\(process\.env\) === "production";/,
  );
  assert.match(
    route,
    /if \(writesBack\) \{\s*await updateUserMetadata\(updatedId/,
  );
});
