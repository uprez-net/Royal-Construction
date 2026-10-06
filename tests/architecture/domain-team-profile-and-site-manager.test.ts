import assert from "node:assert/strict";

import { Role } from "@prisma/client";
import { test } from "vitest";

import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
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
  assert.deepEqual(writes[0], {
    args: { data: { siteManagerId: "user_new" }, where: { id: PROJECT.id } },
    operation: "project.update",
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
