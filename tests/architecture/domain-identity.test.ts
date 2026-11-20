import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OutboxEventStatus, Role } from "@prisma/client";
import { test } from "vitest";

import {
  acceptTeamInvitation,
  roleForNewAccount,
} from "@/lib/domain/identity/invitations";
import { inviteTeamMember } from "@/lib/domain/identity/team";
import { updateUserByClerkId } from "@/lib/domain/identity/users";
import { REPO_ROOT } from "../support/repo-root";
import { adminPrincipal, recordingDb } from "./domain-harness";

test("a repeated CUSTOMER update reuses the linked customer", async () => {
  const recorder = recordingDb({
    "user.update": {
      clerkId: "clerk_1",
      customerId: "customer_1",
      email: "owner@example.com",
      id: "user_1",
      name: "Owner",
      phone: "0400000000",
      role: Role.CUSTOMER,
    },
  });

  const result = await updateUserByClerkId(
    "clerk_1",
    { email: "owner@example.com", role: Role.CUSTOMER },
    recorder.transactionalDb,
  );

  assert.equal(result.customerId, "customer_1");
  assert.deepEqual(recorder.operations(), ["user.update"]);
});

test("the first CUSTOMER update creates and links one customer", async () => {
  const recorder = recordingDb({
    "customer.create": { id: "customer_1" },
    "user.update": (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      return "clerkId" in where
        ? {
            customerId: null,
            email: "owner@example.com",
            id: "user_1",
            name: "Owner",
            phone: "0400000000",
            role: Role.CUSTOMER,
          }
        : {};
    },
  });

  const result = await updateUserByClerkId(
    "clerk_1",
    { role: Role.CUSTOMER },
    recorder.transactionalDb,
  );

  assert.equal(result.customerId, "customer_1");
  assert.deepEqual(recorder.operations(), [
    "user.update",
    "customer.create",
    "user.update",
  ]);
});

/* ----------------------------------------------- team invitations -- */

test("an invited account starts with the role its invitation carried", async () => {
  // Clerk's copy of the invitation's metadata wins, and needs no read.
  const fromClerk = recordingDb();
  assert.deepEqual(
    await roleForNewAccount(
      { email: "new@example.com", metadata: { role: "SITE_MANAGER" } },
      fromClerk.db,
    ),
    { invitationId: null, role: Role.SITE_MANAGER },
  );
  assert.deepEqual(fromClerk.operations(), []);

  // Signed up without the link: our record of the invitation decides.
  const now = new Date("2026-11-20T00:00:00.000Z");
  const recorded = recordingDb({
    "teamInvitation.findFirst": { id: "ti_1", role: Role.SITE_MANAGER },
  });
  assert.deepEqual(
    await roleForNewAccount(
      { email: " New@Example.com ", metadata: {}, now },
      recorded.db,
    ),
    { invitationId: "ti_1", role: Role.SITE_MANAGER },
  );
  assert.deepEqual((recorded.calls[0].args as { where: unknown }).where, {
    email: "new@example.com",
    expiresAt: { gt: now },
    revokedAt: null,
  });

  // Nobody invited them, or the metadata names no role we know.
  const nobody = recordingDb({ "teamInvitation.findFirst": null });
  assert.deepEqual(
    await roleForNewAccount(
      { email: "walk-in@example.com", metadata: { role: "SUPERUSER" } },
      nobody.db,
    ),
    { invitationId: null, role: Role.GUEST },
  );
});

test("an accepted invitation upgrades a GUEST account and nothing else", async () => {
  const accept = (user: { clerkId: string; role: Role } | null) => {
    const recorder = recordingDb({
      "teamInvitation.findUnique": {
        id: "ti_1",
        revokedAt: null,
        role: Role.ADMIN,
      },
      "user.findFirst": user,
      "user.update": {
        customerId: null,
        email: "new@example.com",
        id: "user_1",
        name: "New",
        phone: "0400000000",
        role: Role.ADMIN,
      },
    });
    return {
      recorder,
      run: acceptTeamInvitation(
        {
          clerkInvitationId: "inv_1",
          email: "New@Example.com",
          metadata: null,
        },
        recorder.transactionalDb,
      ),
    };
  };

  const guest = accept({ clerkId: "clerk_1", role: Role.GUEST });
  assert.deepEqual(await guest.run, { clerkId: "clerk_1", role: Role.ADMIN });
  assert.deepEqual(
    guest.recorder.writes().map((write) => write.operation),
    ["teamInvitation.updateMany", "user.update"],
  );

  // An admin already set this account's role: a late event must not undo it.
  const decided = accept({ clerkId: "clerk_1", role: Role.SITE_MANAGER });
  assert.equal(await decided.run, null);
  assert.ok(
    !decided.recorder.operations().includes("user.update"),
    "a role somebody chose is left alone",
  );

  // No account yet: user.created reads the same invitation when it lands.
  assert.equal(await accept(null).run, null);
});

test("a revoked invitation grants nothing", async () => {
  const recorder = recordingDb({
    "teamInvitation.findUnique": {
      id: "ti_1",
      revokedAt: new Date("2026-11-19T00:00:00.000Z"),
      role: Role.ADMIN,
    },
  });
  assert.equal(
    await acceptTeamInvitation(
      { clerkInvitationId: "inv_1", email: "new@example.com", metadata: {} },
      recorder.transactionalDb,
    ),
    null,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("sending an invitation records its role for a sign-up without the link", async () => {
  const recorder = recordingDb({
    "outboxEvent.upsert": {
      id: "effect_1",
      key: "team-invite:k",
      result: null,
      status: OutboxEventStatus.PENDING,
    },
    "outboxEvent.findUnique": {
      attempts: 0,
      id: "effect_1",
      key: "team-invite:k",
      kind: "TEAM_INVITATION_CREATE",
      payload: {},
      status: OutboxEventStatus.PENDING,
    },
    "outboxEvent.updateMany": { count: 1 },
  });
  await inviteTeamMember(
    adminPrincipal(),
    {
      email: "New@Example.com",
      idempotencyKey: "k",
      now: new Date("2026-11-20T00:00:00.000Z"),
      role: Role.SITE_MANAGER,
    },
    recorder.db,
    async () => ({ id: "inv_1" }),
  );
  const upsert = recorder.calls.find(
    (call) => call.operation === "teamInvitation.upsert",
  );
  assert.ok(upsert, "the invitation must be recorded");
  assert.deepEqual((upsert.args as { create: unknown }).create, {
    clerkInvitationId: "inv_1",
    email: "new@example.com",
    expiresAt: new Date("2026-11-27T00:00:00.000Z"),
    role: Role.SITE_MANAGER,
  });
});

test("the Clerk webhook no longer writes GUEST over an invited role", () => {
  const route = readFileSync(
    join(REPO_ROOT, "app/api/webhook/clerk/route.ts"),
    "utf8",
  );
  assert.match(route, /roleForNewAccount\(/);
  assert.match(route, /createUser\(fullName, email, id, phone, role\)/);
  assert.match(route, /"invitation\.accepted"/);
  assert.doesNotMatch(route, /\|\| Role\.GUEST/);
});
