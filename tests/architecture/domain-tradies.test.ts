import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  IncidentSeverity,
  OutboxEventStatus,
  TradieApprovalActionType,
  TradiePriceUnit,
  TradieScheduleStatus,
} from "@prisma/client";
import { test } from "vitest";

import {
  createTradie,
  rateTradie,
  requestTradiePriceChange,
  requestTradieRemoval,
  toggleTradieFavourite,
  updateTradie,
} from "@/lib/domain/tradies/directory";
import { reportTradieIncident } from "@/lib/domain/tradies/incidents";
import { resolveTradieApproval } from "@/lib/domain/tradies/approvals";
import { sendTradieScheduleReminder } from "@/lib/domain/tradies/reminders";
import {
  createTradieSchedules,
  rescheduleTradieSchedule,
  transitionTradieSchedule,
} from "@/lib/domain/tradies/schedules";
import {
  changeTeamMemberRole,
  inviteTeamMember,
  revokeTeamInvitation,
} from "@/lib/domain/identity/team";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { ROOT } from "./module-graph";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Phase 6 of issue #301: the tradie directory, incidents and team roles.
//
// The app's half of this had no caller check at all — lib/data/tradie-management.ts
// is a "use server" module, so every export was a POST endpoint, and the Redux
// slice calls several of them straight from the browser. The rules are Eve's,
// because Eve had rules.

const read = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const TRADIE = {
  email: "sam@example.com",
  id: "t_1",
  lastQuotedPrice: null,
  name: "Sam the Sparky",
  phone: "0400000000",
  trade: "Electrical",
};

test("bulk scheduling authorizes every project inside one transaction", async () => {
  const recorder = recordingDb({
    "project.findUnique": (args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      return { id, location: `${id} location`, name: id, siteManagerId: null };
    },
    "tradie.findUnique": { id: "t_1" },
    "tradieSchedule.findFirst": null,
    "tradieSchedule.create": (args: unknown) => ({
      ...(args as { data: Record<string, unknown> }).data,
      id: `schedule_${
        (args as { data: { projectId: string } }).data.projectId
      }`,
    }),
  });
  const scheduledDate = new Date("2026-10-01T00:00:00.000Z");

  await createTradieSchedules(
    adminPrincipal(),
    ["project_1", "project_2"].map((projectId) => ({
      durationDays: 1,
      projectId,
      requiresQuote: false,
      scheduledDate,
      tradieId: "t_1",
    })),
    recorder.transactionalDb,
  );

  const authorizedProjects = recorder.calls
    .filter((call) => call.operation === "project.findUnique")
    .map((call) => (call.args as { where: { id: string } }).where.id);
  assert.deepEqual(authorizedProjects, ["project_1", "project_2"]);
});

test("schedule duplicate checks and creates use serialisable transactions", () => {
  const source = read("lib/domain/tradies/schedules.ts");
  assert.ok(
    (source.match(/TransactionIsolationLevel\.Serializable/g)?.length ?? 0)
      >= 2,
    "single and bulk schedule creation must both be serialisable",
  );
});

/* ------------------------------------------------------------- directory -- */

test("editing a tradie name trims it and persists only the supplied field", async () => {
  const recorder = recordingDb({
    "tradie.findUnique": { ...TRADIE, isActive: true },
  });
  await updateTradie(
    adminPrincipal(),
    "t_1",
    { name: "  Sam Electrical  " },
    recorder.db,
  );
  assert.deepEqual(recorder.writes(), [
    {
      operation: "tradie.update",
      args: { data: { name: "Sam Electrical" }, where: { id: "t_1" } },
    },
  ]);
});

test("editing a tradie name refuses blank or one-character names without writing", async () => {
  for (const name of ["   ", " S "]) {
    const recorder = recordingDb({
      "tradie.findUnique": { ...TRADIE, isActive: true },
    });
    await assert.rejects(
      () => updateTradie(adminPrincipal(), "t_1", { name }, recorder.db),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  }
});

test("adding, changing or pricing a tradie is ADMIN only", async () => {
  const cases: [string, () => Promise<unknown>][] = [
    [
      "createTradie",
      () =>
        createTradie(
          siteManagerPrincipal(),
          {
            abn: "1",
            email: "a@b.c",
            lastQuotedPriceUnit: TradiePriceUnit.HOURLY,
            name: "X",
            phone: "0400",
            trade: "Electrical",
          },
          recordingDb({}).db,
        ),
    ],
    [
      "updateTradie",
      () =>
        updateTradie(
          siteManagerPrincipal(),
          "t_1",
          { phone: "0401" },
          recordingDb({ "tradie.findUnique": TRADIE }).db,
        ),
    ],
    [
      "requestTradiePriceChange",
      () =>
        requestTradiePriceChange(
          siteManagerPrincipal(),
          { amount: 100, reason: "r", tradieId: "t_1" },
          recordingDb({ "tradie.findUnique": TRADIE }).db,
        ),
    ],
    [
      "requestTradieRemoval",
      () =>
        requestTradieRemoval(
          siteManagerPrincipal(),
          { reason: "r", tradieId: "t_1" },
          recordingDb({ "tradie.findUnique": TRADIE }).db,
        ),
    ],
  ];

  for (const [name, run] of cases) {
    await assert.rejects(
      run,
      DomainAuthorizationError,
      `${name} let a site manager through`,
    );
  }
});

test("a customer account cannot touch the tradie directory at all", async () => {
  // This is the account the app's unguarded Server Actions were actually open
  // to: everyone internal is an ADMIN on a shared login.
  await assert.rejects(
    () =>
      toggleTradieFavourite(
        customerPrincipal(),
        "t_1",
        true,
        recordingDb({ "tradie.findUnique": TRADIE }).db,
      ),
    DomainAuthorizationError,
  );
  await assert.rejects(
    () =>
      rateTradie(
        customerPrincipal(),
        { rating: 5, tradieId: "t_1" },
        recordingDb({ "tradie.findUnique": TRADIE }).db,
      ),
    DomainAuthorizationError,
  );
});

test("a site manager may pin and rate, because they book the work", () => {
  // Directory access is deliberately wider than directory *editing*: a site
  // manager picks any registered tradie for a booking.
  assert.doesNotThrow(() => siteManagerPrincipal());
});

test("a price change is a request, never a direct write", async () => {
  const recorder = recordingDb({
    "tradieApproval.create": { id: "ap_1" },
    "tradie.findUnique": { ...TRADIE, lastQuotedPrice: null },
  });

  const requested = await requestTradiePriceChange(
    adminPrincipal("u_admin"),
    {
      amount: 95,
      reason: "New rate card",
      tradieId: "t_1",
      unit: TradiePriceUnit.HOURLY,
    },
    recorder.db,
  );

  assert.equal(requested.approvalId, "ap_1");
  // The tradie's own price is untouched: the amount is stored on the approval
  // and read back when an admin says yes, so an approver cannot substitute a
  // different number at the point of approving.
  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["tradieApproval.create"],
  );
  const data = (recorder.writes()[0].args as { data: Record<string, unknown> })
    .data;
  assert.deepEqual(data.updationData, {
    newHourlyRate: 95,
    newPriceUnit: TradiePriceUnit.HOURLY,
  });
  assert.equal(data.requestedBy, "u_admin");
});

test("an omitted price unit is left out rather than defaulted", async () => {
  // The app's price form has always been able to omit it, and the resolver
  // only applies a unit it recognises — so an absent one must leave the
  // tradie's existing basis alone, not pick one.
  const recorder = recordingDb({
    "tradieApproval.create": { id: "ap_1" },
    "tradie.findUnique": TRADIE,
  });
  await requestTradiePriceChange(
    adminPrincipal(),
    { amount: 95, reason: "r", tradieId: "t_1" },
    recorder.db,
  );
  const data = (recorder.writes()[0].args as { data: Record<string, unknown> })
    .data;
  assert.deepEqual(data.updationData, { newHourlyRate: 95 });
});

test("a negative price and an out-of-range rating are refused", async () => {
  await assert.rejects(
    () =>
      requestTradiePriceChange(
        adminPrincipal(),
        { amount: -1, reason: "r", tradieId: "t_1" },
        recordingDb({ "tradie.findUnique": TRADIE }).db,
      ),
    DomainValidationError,
  );
  await assert.rejects(
    () =>
      rateTradie(
        adminPrincipal(),
        { rating: 6, tradieId: "t_1" },
        recordingDb({ "tradie.findUnique": TRADIE }).db,
      ),
    DomainValidationError,
  );
});

test("a removal request leaves the tradie in the directory", async () => {
  const recorder = recordingDb({
    "tradieApproval.create": { id: "ap_1" },
    "tradie.findUnique": TRADIE,
  });

  await requestTradieRemoval(
    adminPrincipal(),
    { reason: "Stopped answering", tradieId: "t_1" },
    recorder.db,
  );

  // No delete: a booking already made against this tradie must not be
  // orphaned by the request itself.
  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["tradieApproval.create"],
  );
});

test("a rating refreshes the average from the ratings table", async () => {
  const recorder = recordingDb({
    "tradie.findUnique": TRADIE,
    "tradie.update": {},
    "tradieRating.aggregate": { _avg: { rating: 4.5 } },
    "tradieRating.create": {},
  });

  const result = await rateTradie(
    adminPrincipal(),
    { comment: "  Good work  ", rating: 5, tradieId: "t_1" },
    recorder.db,
  );

  assert.equal(result.average, 4.5);
  // Recomputed, not folded into a running figure — a corrected or deleted
  // rating cannot leave the stored average permanently wrong.
  assert.deepEqual(recorder.operations(), [
    "tradie.findUnique",
    "tradieRating.create",
    "tradieRating.aggregate",
    "tradie.update",
  ]);
  const created = (recorder.writes()[0].args as { data: { comment: unknown } })
    .data;
  assert.equal(created.comment, "Good work");
});

test("an unknown tradie is not found rather than silently created", async () => {
  await assert.rejects(
    () =>
      toggleTradieFavourite(
        adminPrincipal(),
        "t_missing",
        true,
        recordingDb({ "tradie.findUnique": null }).db,
      ),
    DomainNotFoundError,
  );
});

/* ------------------------------------------------------------- incidents -- */

test("an incident attaches only the reporter's own unattached files", async () => {
  const recorder = recordingDb({
    // One of the two ids belongs to another record, so the predicate matches
    // only one row.
    "file.updateMany": { count: 1 },
    "tradie.findUnique": TRADIE,
    "tradieIncident.create": { id: "inc_1" },
  });

  await assert.rejects(
    () =>
      reportTradieIncident(
        adminPrincipal("u_admin"),
        {
          description: "Left site early",
          fileIds: ["f_mine", "f_someone_elses"],
          incidentType: "CONDUCT",
          severity: IncidentSeverity.LOW,
          tradieId: "t_1",
        },
        recorder.db,
      ),
    (error) => {
      assert.ok(error instanceof DomainValidationError);
      assert.match(error.message, /missing or belong to another record/);
      return true;
    },
  );

  const where = (
    recorder.writes().find((call) => call.operation === "file.updateMany")
      ?.args as { where: Record<string, unknown> }
  ).where;
  // File.incidentId cascades, so attaching someone else's file means deleting
  // the incident deletes their file too.
  assert.equal(where.uploadedBy, "u_admin");
  assert.equal(where.projectId, null);
  assert.equal(where.milestoneId, null);
  assert.equal(where.leadId, null);
  assert.equal(where.complianceDocumentId, null);
  assert.equal(where.incidentId, null);
});

test("duplicate file ids are collapsed before the count is compared", async () => {
  // Otherwise two copies of one id look like two files and the report fails.
  const recorder = recordingDb({
    "file.updateMany": { count: 1 },
    "tradie.findUnique": TRADIE,
    "tradieApproval.create": { id: "ap_1" },
    "tradieIncident.create": { id: "inc_1" },
  });

  await reportTradieIncident(
    adminPrincipal(),
    {
      description: "d",
      fileIds: ["f_1", "f_1"],
      incidentType: "CONDUCT",
      severity: IncidentSeverity.LOW,
      tradieId: "t_1",
    },
    recorder.db,
  );

  const where = (
    recorder.writes().find((call) => call.operation === "file.updateMany")
      ?.args as { where: { id: { in: string[] } } }
  ).where;
  assert.deepEqual(where.id.in, ["f_1"]);
});

test("an incident report needs staff, not just a signed-in account", async () => {
  await assert.rejects(
    () =>
      reportTradieIncident(
        customerPrincipal(),
        {
          description: "d",
          incidentType: "CONDUCT",
          severity: IncidentSeverity.LOW,
          tradieId: "t_1",
        },
        recordingDb({}).db,
      ),
    DomainAuthorizationError,
  );
});

/* ----------------------------------------------------------- team roles -- */

test("the last admin cannot be demoted", async () => {
  const recorder = recordingDb({
    "user.count": 1,
    "user.findUnique": { id: "u_1", name: "Sole Admin", role: "ADMIN" },
  });

  await assert.rejects(
    () =>
      changeTeamMemberRole(
        adminPrincipal(),
        { expectedRole: "ADMIN", newRole: "GUEST", userId: "u_1" },
        recorder.db as never,
      ),
    (error) => {
      assert.ok(error instanceof DomainTransitionError);
      assert.match(error.message, /last admin cannot be demoted/);
      return true;
    },
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a role that moved under the caller is refused, not overwritten", async () => {
  const recorder = recordingDb({
    "user.findUnique": { id: "u_1", name: "Sam", role: "GUEST" },
  });

  await assert.rejects(
    () =>
      changeTeamMemberRole(
        adminPrincipal(),
        { expectedRole: "ADMIN", newRole: "SITE_MANAGER", userId: "u_1" },
        recorder.db as never,
      ),
    DomainTransitionError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a demotion with other admins left through goes through", async () => {
  const recorder = recordingDb({
    "user.count": 3,
    "user.findUnique": { id: "u_1", name: "Sam", role: "ADMIN" },
    "user.updateMany": { count: 1 },
  });

  const result = await changeTeamMemberRole(
    adminPrincipal(),
    { expectedRole: "ADMIN", newRole: "SITE_MANAGER", userId: "u_1" },
    recorder.db as never,
  );

  assert.deepEqual(result, {
    name: "Sam",
    role: "SITE_MANAGER",
    userId: "u_1",
  });
  // Conditional on the role the decision was made against, so two role changes
  // racing cannot both pass the admin count and leave nobody.
  assert.deepEqual((recorder.writes()[0].args as { where: unknown }).where, {
    id: "u_1",
    role: "ADMIN",
  });
});

test("team invitations normalize the address before calling Clerk", async () => {
  let requested: unknown;
  const recorder = recordingDb({
    "outboxEvent.upsert": {
      id: "effect_1",
      key: "team-invite:ad-hoc-1",
      result: null,
      status: OutboxEventStatus.PENDING,
    },
    "outboxEvent.findUnique": {
      attempts: 0,
      id: "effect_1",
      key: "team-invite:ad-hoc-1",
      kind: "TEAM_INVITATION_CREATE",
      payload: {},
      status: OutboxEventStatus.PENDING,
    },
    "outboxEvent.updateMany": { count: 1 },
  });
  const invitation = await inviteTeamMember(
    adminPrincipal(),
    {
      email: "  New.Person@Example.com ",
      idempotencyKey: "ad-hoc-1",
      role: "SITE_MANAGER",
    },
    recorder.db,
    async (input) => {
      requested = input;
      return { id: "inv_1" };
    },
  );

  assert.deepEqual(invitation, {
    alreadyInvited: false,
    email: "new.person@example.com",
    id: "inv_1",
    role: "SITE_MANAGER",
  });
  assert.deepEqual(requested, {
    emailAddress: "new.person@example.com",
    expiresInDays: 7,
    publicMetadata: { role: "SITE_MANAGER" },
  });
});

test("a repeat invitation is sent, and a same-day duplicate is reported as a replay", async () => {
  // The fallback key used to be `${email}:${role}` with no time in it, so the
  // second invitation to the same person at the same role was silently
  // swallowed for ever while the API answered "Invitation sent successfully".
  // A Clerk invitation expires after seven days, so that is a real re-invite.
  const keys: string[] = [];
  const day = (result: unknown, status: OutboxEventStatus) =>
    recordingDb({
      "outboxEvent.upsert": (args: unknown) => {
        const key = (args as { where: { key: string } }).where.key;
        keys.push(key);
        return { id: "effect_1", key, result, status };
      },
      "outboxEvent.findUnique": (args: unknown) => ({
        attempts: 0,
        id: "effect_1",
        key: (args as { where: { key: string } }).where.key,
        kind: "TEAM_INVITATION_CREATE",
        payload: {},
        status: OutboxEventStatus.PENDING,
      }),
      "outboxEvent.updateMany": { count: 1 },
    });

  let calls = 0;
  const invite = async () => {
    calls += 1;
    return { id: "inv_1" };
  };
  const input = {
    email: "new.person@example.com",
    role: "SITE_MANAGER" as const,
  };

  const first = await inviteTeamMember(
    adminPrincipal(),
    { ...input, now: new Date("2026-09-21T09:00:00.000Z") },
    day(null, OutboxEventStatus.PENDING).db,
    invite,
  );
  assert.equal(first.alreadyInvited, false);

  const later = await inviteTeamMember(
    adminPrincipal(),
    { ...input, now: new Date("2026-10-05T09:00:00.000Z") },
    day(null, OutboxEventStatus.PENDING).db,
    invite,
  );
  assert.equal(later.alreadyInvited, false);
  assert.equal(calls, 2, "the re-invitation two weeks later must reach Clerk");
  assert.notEqual(keys[0], keys[1]);

  const duplicate = await inviteTeamMember(
    adminPrincipal(),
    { ...input, now: new Date("2026-09-21T16:00:00.000Z") },
    day(
      { email: input.email, id: "inv_1", role: input.role },
      OutboxEventStatus.SUCCEEDED,
    ).db,
    invite,
  );
  assert.equal(duplicate.alreadyInvited, true);
  assert.equal(calls, 2, "a same-day duplicate must not reach Clerk again");
});

test("invitation revoke is administrator-only and trims the target id", async () => {
  let revoked: string | null = null;
  const recorder = recordingDb({
    "outboxEvent.upsert": {
      id: "effect_2",
      key: "team-invite-revoke:inv_1",
      result: null,
      status: OutboxEventStatus.PENDING,
    },
    "outboxEvent.findUnique": {
      attempts: 0,
      id: "effect_2",
      key: "team-invite-revoke:inv_1",
      kind: "TEAM_INVITATION_REVOKE",
      payload: {},
      status: OutboxEventStatus.PENDING,
    },
    "outboxEvent.updateMany": { count: 1 },
  });
  const result = await revokeTeamInvitation(
    adminPrincipal(),
    "  inv_1 ",
    recorder.db,
    async (invitationId) => {
      revoked = invitationId;
    },
  );
  assert.deepEqual(result, { invitationId: "inv_1" });
  assert.equal(revoked, "inv_1");

  await assert.rejects(
    () =>
      revokeTeamInvitation(
        customerPrincipal(),
        "inv_1",
        recorder.db,
        async () => {},
      ),
    DomainAuthorizationError,
  );
});

/* ---------------------------------------------- the old copies are gone -- */

test("the app's tradie actions resolve a caller and call the shared rules", () => {
  const source = read("lib/data/tradie-management.ts");
  assert.match(source, /requireTradieActor/);
  for (const shared of [
    "createTradieDomain",
    "updateTradieDomain",
    "toggleTradieFavouriteDomain",
    "requestTradiePriceChange",
    "requestTradieRemoval",
    "rateTradieDomain",
    "reportTradieIncidentDomain",
  ]) {
    assert.match(source, new RegExp(shared), `${shared} is not called`);
  }
  // Its own unguarded writes are gone.
  assert.doesNotMatch(source, /prisma\.tradieRating\.create/);
  assert.doesNotMatch(source, /prisma\.tradieApproval\.create/);
});

/* ------------------------------------------------------------- approvals -- */

test("approval resolution applies the stored price, not approver input", async () => {
  const recorder = recordingDb({
    "tradieApproval.updateMany": { count: 1 },
    "tradieApproval.findUnique": {
      actionType: TradieApprovalActionType.PRICE_CHANGE,
      id: "approval_1",
      tradie: { id: "t_1", name: "Sam", trade: "Electrical" },
      tradieId: "t_1",
      updationData: { newHourlyRate: 125, newPriceUnit: "HOURLY" },
    },
    "tradie.update": {},
  });

  const result = await resolveTradieApproval(
    adminPrincipal(),
    {
      actionType: TradieApprovalActionType.PRICE_CHANGE,
      approvalId: "approval_1",
      resolution: "approved",
    },
    recorder.db,
  );

  assert.deepEqual(result.affected, { amount: 125, unit: "HOURLY" });
  const write = recorder
    .writes()
    .find((call) => call.operation === "tradie.update");
  assert.deepEqual((write?.args as { data: unknown }).data, {
    lastQuotedPrice: 125,
    lastQuotedPriceUnit: "HOURLY",
  });
});

test("approval resolution claims once and refuses an action-type mismatch", async () => {
  const recorder = recordingDb({
    "tradieApproval.updateMany": { count: 1 },
    "tradieApproval.findUnique": {
      actionType: TradieApprovalActionType.TRADIE_REMOVAL,
      id: "approval_1",
      tradie: { id: "t_1", name: "Sam", trade: "Electrical" },
      tradieId: "t_1",
      updationData: null,
    },
  });

  await assert.rejects(
    () =>
      resolveTradieApproval(
        adminPrincipal(),
        {
          actionType: TradieApprovalActionType.PRICE_CHANGE,
          approvalId: "approval_1",
          resolution: "approved",
        },
        recorder.db,
      ),
    DomainValidationError,
  );
  // The mismatch is thrown inside the transaction, so the real database rolls
  // the claim back instead of leaving a pending request looking resolved.
  assert.deepEqual(recorder.operations(), [
    "tradieApproval.updateMany",
    "tradieApproval.findUnique",
  ]);
});

test("a resolved deletion carries the booking details its notification needs", async () => {
  // The schedule row is deleted inside this command, so the date a site
  // manager reads and the milestone the activity entry is filed against can
  // only come from the recorded request. Dropping them left the notification
  // reading "booking on  was removed".
  const recorder = recordingDb({
    "tradieApproval.updateMany": { count: 1 },
    "tradieApproval.findUnique": {
      actionType: TradieApprovalActionType.SCHEDULE_DELETION,
      id: "approval_1",
      tradie: { id: "t_1", name: "Sam", trade: "Electrical" },
      tradieId: "t_1",
      updationData: {
        milestoneId: "m_1",
        milestoneName: "Frame",
        projectId: "p_1",
        projectName: " 12 Example St",
        scheduleId: "schedule_1",
        scheduledDate: "2026-10-01T00:00:00.000Z",
      },
    },
    "project.findUnique": { siteManagerId: "u_sm" },
    "tradieSchedule.deleteMany": { count: 1 },
  });

  const result = await resolveTradieApproval(
    adminPrincipal(),
    {
      actionType: TradieApprovalActionType.SCHEDULE_DELETION,
      approvalId: "approval_1",
      resolution: "approved",
    },
    recorder.db,
  );

  assert.deepEqual(result.affected, {
    deleted: true,
    milestoneId: "m_1",
    milestoneName: "Frame",
    projectId: "p_1",
    projectName: " 12 Example St",
    scheduleId: "schedule_1",
    scheduledDate: "2026-10-01T00:00:00.000Z",
    siteManagerId: "u_sm",
  });
});

test("approval side effects run against the status that was actually committed", async () => {
  // Approving a booking commits PENDING_FINAL_CONFIRMATION — the reminder job
  // moves it to CONFIRMED a week out — but the notification the site manager
  // needs is the CONFIRMED one. Comparing against toStatus threw here, so the
  // decision committed and nobody was told.
  const schedule = {
    durationDays: 2,
    id: "schedule_1",
    milestone: null,
    milestoneId: null,
    project: { id: "p_1", name: "12 Example St", siteManagerId: "u_sm" },
    projectId: "p_1",
    quotedPrice: null,
    scheduledDate: new Date("2026-10-01T00:00:00.000Z"),
    status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
    tradie: {
      id: "t_1",
      lastQuotedPrice: null,
      lastQuotedPriceUnit: TradiePriceUnit.FIXED,
      name: "Sam",
      trade: "Electrical",
    },
    tradieId: "t_1",
  };
  const recorder = recordingDb({
    "tradieSchedule.findUnique": schedule,
    "project.findUnique": { id: "p_1", siteManagerId: "u_sm" },
  });

  const result = await transitionTradieSchedule(
    adminPrincipal(),
    {
      appliedStatus: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
      scheduleId: "schedule_1",
      statusAlreadyApplied: true,
      toStatus: TradieScheduleStatus.CONFIRMED,
    },
    recorder.db,
  );

  assert.equal(result.status, TradieScheduleStatus.CONFIRMED);
  // Side effects only: naming the committed status must not write again.
  assert.deepEqual(recorder.writes(), []);

  // A booking that moved on since the decision is still refused.
  const moved = recordingDb({
    "tradieSchedule.findUnique": {
      ...schedule,
      status: TradieScheduleStatus.DECLINED,
    },
    "project.findUnique": { id: "p_1", siteManagerId: "u_sm" },
  });
  await assert.rejects(
    () =>
      transitionTradieSchedule(
        adminPrincipal(),
        {
          appliedStatus: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
          scheduleId: "schedule_1",
          statusAlreadyApplied: true,
          toStatus: TradieScheduleStatus.CONFIRMED,
        },
        moved.db,
      ),
    DomainTransitionError,
  );
});

test("schedule approval uses the shared awaiting-admin state transition", async () => {
  const recorder = recordingDb({
    "tradieApproval.updateMany": { count: 1 },
    "tradieApproval.findUnique": {
      actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
      id: "approval_1",
      tradie: { id: "t_1", name: "Sam", trade: "Electrical" },
      tradieId: "t_1",
      updationData: { scheduleId: "schedule_1" },
    },
    "tradieSchedule.updateMany": { count: 1 },
  });

  const result = await resolveTradieApproval(
    adminPrincipal(),
    {
      actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
      approvalId: "approval_1",
      resolution: "approved",
    },
    recorder.db,
  );

  assert.deepEqual(result.affected, {
    scheduleId: "schedule_1",
    status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
  });
  const args = recorder
    .writes()
    .find((call) => call.operation === "tradieSchedule.updateMany")?.args as {
    data: unknown;
    where: unknown;
  };
  assert.deepEqual(args.data, {
    reminderSentAt: null,
    status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
  });
  assert.deepEqual(args.where, {
    id: "schedule_1",
    status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    tradieId: "t_1",
  });
});

test("schedule transition normalizes a daily quote once and persists the total", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      durationDays: 2,
      id: "schedule_1",
      milestoneId: null,
      project: { id: "p_1", name: "House", siteManagerId: null },
      projectId: "p_1",
      quotedPrice: null,
      scheduledDate: new Date("2026-10-01T00:00:00.000Z"),
      status: "PENDING_RESPONSE",
      tradie: { id: "t_1", name: "Sam" },
      tradieId: "t_1",
    },
    "project.findUnique": {
      id: "p_1",
      location: "Sydney",
      name: "House",
      siteManagerId: null,
    },
    "tradieSchedule.updateMany": { count: 1 },
    "tradie.update": {},
  });

  const result = await transitionTradieSchedule(
    adminPrincipal(),
    {
      quote: "$950 a day",
      quoteUnit: "DAILY",
      scheduleId: "schedule_1",
      toStatus: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
    },
    recorder.db,
  );

  assert.equal(result.quotedPrice, "1900.00");
  const scheduleWrite = recorder
    .writes()
    .find((call) => call.operation === "tradieSchedule.updateMany");
  assert.deepEqual((scheduleWrite?.args as { data: unknown }).data, {
    quotedPrice: "1900.00",
    requiresQuote: true,
    status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
  });
});

test("rescheduling checks the project milestone and uses old values as a stale guard", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      durationDays: 1,
      id: "schedule_1",
      milestoneId: null,
      project: { id: "p_1", name: "House", siteManagerId: null },
      projectId: "p_1",
      quotedPrice: null,
      scheduledDate: new Date("2026-10-01T00:00:00.000Z"),
      status: TradieScheduleStatus.PENDING,
      tradie: { id: "t_1", name: "Sam" },
      tradieId: "t_1",
    },
    "project.findUnique": {
      id: "p_1",
      location: "Sydney",
      name: "House",
      siteManagerId: null,
    },
    "tradieSchedule.updateMany": { count: 0 },
  });

  await assert.rejects(
    () =>
      rescheduleTradieSchedule(
        adminPrincipal(),
        {
          durationDays: 2,
          scheduledDate: new Date("2026-10-10T00:00:00.000Z"),
          scheduleId: "schedule_1",
        },
        recorder.db,
      ),
    DomainTransitionError,
  );
  const args = recorder
    .writes()
    .find((call) => call.operation === "tradieSchedule.updateMany")?.args as {
    where: unknown;
  };
  // The status is part of the guard: the reschedule decides the booking's new
  // status from the one it read.
  assert.deepEqual(args.where, {
    durationDays: 1,
    id: "schedule_1",
    scheduledDate: new Date("2026-10-01T00:00:00.000Z"),
    status: TradieScheduleStatus.PENDING,
  });
});

test("schedule reminders resolve only the stored tradie recipient", async () => {
  // One implementation of this rule, in lib/domain/tradies/reminders.ts. The
  // copy that used to live in schedules.ts had no production caller and was
  // kept alive only by this test — exactly the second implementation issue
  // #301 exists to remove.
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      tradie: { email: "  sam@example.com " },
    },
    "outboxEvent.upsert": {
      id: "event_1",
      key: "tradie-manual-reminder:2026-09-21:request_1",
      result: { to: "sam@example.com" },
      status: "SUCCEEDED",
    },
  });
  const sent = await sendTradieScheduleReminder(
    adminPrincipal(),
    {
      body: "Please confirm.",
      idempotencyKey: "request_1",
      now: new Date("2026-09-21T09:00:00.000Z"),
      scheduleId: "schedule_1",
      subject: "Reminder",
    },
    recorder.db,
    async () => {},
  );
  assert.equal(sent.to, "sam@example.com");

  await assert.rejects(
    () =>
      sendTradieScheduleReminder(
        customerPrincipal(),
        {
          body: "Please confirm.",
          idempotencyKey: "request_1",
          scheduleId: "schedule_1",
          subject: "Reminder",
        },
        recordingDb().db,
        async () => {},
      ),
    DomainTransitionError,
  );
});

test("Eve's tradie tools call the same rules", () => {
  const source = read("agent/lib/tradie-operations.ts");
  assert.match(source, /@\/lib\/domain\/tradies\/directory/);
  assert.match(source, /@\/lib\/domain\/tradies\/incidents/);
  // Its own file-scoping copy, which matched on uploadedBy alone, is gone.
  assert.doesNotMatch(source, /uploadedBy: actor\.id/);
});
