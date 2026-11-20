import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Role } from "@prisma/client";
import { test } from "vitest";

import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainStaleVersionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  listTeamMembers,
  teamPhoneE164,
  updateTeamMemberProfile,
  type TeamProfilePort,
} from "@/lib/domain/identity/team";
import { assignProjectSiteManager } from "@/lib/domain/projects/commands";
import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";
import { formatAuPhone } from "@/utils/phone";
import { REPO_ROOT } from "../support/repo-root";

// Two small admin edits: reassigning a project's site manager from its header,
// and correcting a team member's name and phone in Clerk and locally.

const MEMBER = {
  clerkId: "clerk_jane",
  email: "jane@example.com",
  id: "user_jane",
  name: "Jane Doe",
  phone: "+61400000000",
  role: Role.ADMIN,
};

function recordingPort() {
  const sent: Parameters<TeamProfilePort>[0][] = [];
  const port: TeamProfilePort = async (input) => {
    sent.push(input);
  };
  return { port, sent };
}

test("a team phone is read as E.164, with a local Australian number as +61", () => {
  assert.equal(teamPhoneE164("0412 345 678"), "+61412345678");
  assert.equal(teamPhoneE164("+61 412 345 678"), "+61412345678");
  assert.equal(teamPhoneE164("+1 (415) 555-0100"), "+14155550100");
  assert.equal(teamPhoneE164("412 345 678"), null);
  assert.equal(teamPhoneE164("+0412345678"), null);
  assert.equal(teamPhoneE164("phone"), null);
});

test("a profile edit writes Clerk, then the local name and phone, never the email", async () => {
  const recorder = recordingDb({
    "user.findFirst": null,
    "user.findUnique": MEMBER,
  });
  const { port, sent } = recordingPort();

  const result = await updateTeamMemberProfile(
    adminPrincipal(),
    {
      clerkUserId: MEMBER.clerkId,
      name: "  Jane   Mary Smith ",
      phone: "0412 345 678",
    },
    recorder.db,
    port,
  );

  assert.deepEqual(sent, [
    {
      clerkUserId: MEMBER.clerkId,
      firstName: "Jane",
      lastName: "Mary Smith",
      phone: "+61412345678",
    },
  ]);
  assert.deepEqual(recorder.writes(), [
    {
      args: {
        data: { name: "Jane Mary Smith", phone: "+61412345678" },
        where: { id: MEMBER.id },
      },
      operation: "user.update",
    },
  ]);
  assert.equal(result.name, "Jane Mary Smith");
});

test("a phone another member holds is refused before Clerk is touched", async () => {
  const recorder = recordingDb({
    "user.findFirst": { id: "user_other" },
    "user.findUnique": MEMBER,
  });
  const { port, sent } = recordingPort();

  await assert.rejects(
    updateTeamMemberProfile(
      adminPrincipal(),
      { clerkUserId: MEMBER.clerkId, name: "Jane", phone: "0412345678" },
      recorder.db,
      port,
    ),
    DomainValidationError,
  );
  assert.deepEqual(sent, []);
  assert.deepEqual(recorder.writes(), []);
});

test("a Clerk refusal surfaces and leaves the local record alone", async () => {
  const recorder = recordingDb({
    "user.findFirst": null,
    "user.findUnique": MEMBER,
  });

  await assert.rejects(
    updateTeamMemberProfile(
      adminPrincipal(),
      { clerkUserId: MEMBER.clerkId, name: "Jane", phone: "0412345678" },
      recorder.db,
      async () => {
        throw new Error("phone numbers are not enabled");
      },
    ),
    (error: unknown) =>
      error instanceof DomainSideEffectError
      && /phone numbers are not enabled/.test(error.message),
  );
  assert.deepEqual(recorder.writes(), []);
});

test("only an ADMIN may edit a team member, and an unknown one is not found", async () => {
  const { port } = recordingPort();
  await assert.rejects(
    updateTeamMemberProfile(
      siteManagerPrincipal(),
      { clerkUserId: MEMBER.clerkId, name: "Jane", phone: "0412345678" },
      recordingDb().db,
      port,
    ),
    DomainAuthorizationError,
  );
  await assert.rejects(
    updateTeamMemberProfile(
      adminPrincipal(),
      { clerkUserId: "clerk_nobody", name: "Jane", phone: "0412345678" },
      recordingDb({ "user.findUnique": null }).db,
      port,
    ),
    DomainNotFoundError,
  );
});

const PROJECT = {
  id: "project_1",
  location: "1 Smith St",
  name: "Smith residence",
  siteManagerId: "user_old",
};

test("reassigning a site manager updates the project and logs who it went to", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "user.findFirst": {
      email: "new@example.com",
      id: "user_new",
      name: "New Manager",
      role: Role.SITE_MANAGER,
    },
    "user.findUnique": { name: "Old Manager" },
  });

  const result = await assignProjectSiteManager(
    adminPrincipal(),
    { projectId: PROJECT.id, siteManagerId: "user_new" },
    recorder.db,
  );

  assert.equal(result.changed, true);
  assert.equal(result.previousSiteManagerId, "user_old");
  const writes = recorder.writes();
  // Conditional on the manager the decision was read against.
  assert.deepEqual(writes[0], {
    args: {
      data: { siteManagerId: "user_new" },
      where: { id: PROJECT.id, siteManagerId: "user_old" },
    },
    operation: "project.updateMany",
  });
  assert.equal(writes[1]?.operation, "activityLog.create");
  assert.match(
    JSON.stringify(writes[1]?.args),
    /Site manager changed from Old Manager to New Manager/,
  );
});

test("reassigning to the current site manager writes nothing", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "user.findFirst": {
      email: "old@example.com",
      id: "user_old",
      name: "Old Manager",
      role: Role.SITE_MANAGER,
    },
  });

  const result = await assignProjectSiteManager(
    adminPrincipal(),
    { projectId: PROJECT.id, siteManagerId: "user_old" },
    recorder.db,
  );
  assert.equal(result.changed, false);
  assert.deepEqual(recorder.writes(), []);
});

test("a site manager may not reassign, and nobody may hand a build to a non-assignable account", async () => {
  await assert.rejects(
    assignProjectSiteManager(
      siteManagerPrincipal("user_old"),
      { projectId: PROJECT.id, siteManagerId: "user_new" },
      recordingDb().db,
    ),
    DomainAuthorizationError,
  );

  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "user.findFirst": null,
  });
  await assert.rejects(
    assignProjectSiteManager(
      adminPrincipal(),
      { projectId: PROJECT.id, siteManagerId: "user_customer" },
      recorder.db,
    ),
    DomainNotFoundError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a team phone reads in AU format and that format saves back unchanged", () => {
  const cases: [string, string][] = [
    ["+61412345678", "0412 345 678"],
    ["+61298765432", "(02) 9876 5432"],
    ["0412345678", "0412 345 678"],
    ["+14155550100", "+14155550100"],
    ["", ""],
  ];
  for (const [stored, shown] of cases) {
    assert.equal(formatAuPhone(stored), shown, stored);
  }
  // What the table shows is what the editor is prefilled with, so it has to
  // be something the domain accepts as the same number.
  for (const stored of ["+61412345678", "+61298765432"]) {
    assert.equal(teamPhoneE164(formatAuPhone(stored)), stored);
  }
});

test("the team screen lists application users, searched and paged in the database", async () => {
  const recorder = recordingDb({
    "user.count": 21,
    "user.findMany": [
      {
        clerkId: "clerk_jane",
        email: "jane@example.com",
        id: "u1",
        name: "Jane",
        phone: "+61412345678",
        role: Role.ADMIN,
      },
    ],
  });
  const listed = await listTeamMembers(
    adminPrincipal(),
    { limit: 20, page: 2, q: " jane " },
    recorder.db,
  );
  assert.equal(listed.total, 21);
  assert.equal(listed.members[0]?.clerkId, "clerk_jane");
  const query = recorder.calls[0]?.args as {
    skip: number;
    take: number;
    where: { OR: unknown[] };
  };
  assert.equal(query.skip, 20);
  assert.equal(query.take, 20);
  assert.deepEqual(query.where.OR[0], {
    name: { contains: "jane", mode: "insensitive" },
  });
  assert.deepEqual(recorder.writes(), []);
});

test("only an admin may list the team", async () => {
  const recorder = recordingDb();
  await assert.rejects(
    listTeamMembers(
      siteManagerPrincipal(),
      { limit: 20, page: 1, q: "" },
      recorder.db,
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.calls, []);
});

test("a team phone goes to Clerk metadata, never to Clerk's phone numbers", () => {
  const route = readFileSync(
    join(REPO_ROOT, "app/api/(data)/users/profile/route.ts"),
    "utf8",
  );
  // updateUserMetadata merges; updateUser({ publicMetadata }) would replace
  // the object and drop the member's role with it.
  assert.match(
    route,
    /updateUserMetadata\([^)]*\{\s*publicMetadata: \{ phone \}/,
  );
  assert.doesNotMatch(route, /phoneNumbers\./);
  assert.doesNotMatch(route, /\.updateUser\([^)]*publicMetadata/);

  const webhook = readFileSync(
    join(REPO_ROOT, "app/api/webhook/clerk/route.ts"),
    "utf8",
  );
  assert.match(webhook, /public_metadata/);
  assert.doesNotMatch(webhook, /phone_numbers/);
});

test("a second request that lost the race is refused and logs nothing", async () => {
  // One person, two requests: a double-click, or a retry after a timeout. The
  // first moved the project; this one decided against the old manager.
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "project.updateMany": { count: 0 },
    "user.findFirst": {
      email: "new@example.com",
      id: "user_new",
      name: "New Manager",
      role: Role.SITE_MANAGER,
    },
    "user.findUnique": { name: "Old Manager" },
  });
  await assert.rejects(
    assignProjectSiteManager(
      adminPrincipal(),
      { projectId: PROJECT.id, siteManagerId: "user_new" },
      recorder.db,
    ),
    DomainStaleVersionError,
  );
  assert.ok(!recorder.operations().includes("activityLog.create"));
});

test("a failed local write puts Clerk back to what the database holds", async () => {
  const recorder = recordingDb({
    "user.findFirst": null,
    "user.findUnique": MEMBER,
    "user.update": () => {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
    },
  });
  const { port, sent } = recordingPort();

  await assert.rejects(
    updateTeamMemberProfile(
      adminPrincipal(),
      { clerkUserId: MEMBER.clerkId, name: "Jane Smith", phone: "0412345678" },
      recorder.db,
      port,
    ),
    DomainValidationError,
  );
  assert.deepEqual(sent, [
    {
      clerkUserId: MEMBER.clerkId,
      firstName: "Jane",
      lastName: "Smith",
      phone: "+61412345678",
    },
    // The compensation: the stored name and phone, not the attempted ones.
    {
      clerkUserId: MEMBER.clerkId,
      firstName: "Jane",
      lastName: "Doe",
      phone: MEMBER.phone,
    },
  ]);
});

test("a schedule transition refusal reaches the caller unchanged", () => {
  const updates = readFileSync(
    join(REPO_ROOT, "lib/data/tradie-schedule-updates.ts"),
    "utf8",
  );
  assert.match(updates, /if \(isDomainError\(error\)\) throw error;/);
  const route = readFileSync(
    join(REPO_ROOT, "app/api/(data)/tradie-schedules/[scheduleId]/route.ts"),
    "utf8",
  );
  assert.match(route, /domainErrorResponse\(error\)/);
});
