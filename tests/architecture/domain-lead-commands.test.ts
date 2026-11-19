import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import {
  archiveLead,
  createLead,
  updateLead,
} from "@/lib/domain/leads/commands";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
} from "@/lib/domain/errors";
import { isLeadValidationError } from "@/lib/leads/lead-validation-error";
import { ROOT } from "./module-graph";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Phase 2, the part that was left: the lead record itself.
//
// The earlier pass moved lead tasks, queries and the offer→lead stage
// projection and stopped, on the grounds that the lead writes were app-only
// with no second implementation to reconcile. True about duplication, wrong
// about authorization — `PATCH /api/leads/[leadId]`, `DELETE`, and the MCP
// update/delete tools acted on whatever id arrived, behind a middleware that
// only proves the caller is signed in and not a GUEST. That is the same shape
// as the lead-task routes this migration already closed, on the records the
// tasks hang off.

const read = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

/** Narrowed once, so the tests can name the id the lead is assigned to. */
const CUSTOMER = (() => {
  const principal = customerPrincipal();
  if (principal.kind !== "user") throw new Error("expected a user principal");
  return principal;
})();

const BASE_LEAD = {
  assignedId: null as string | null,
  followupDate: null,
  followupTime: null,
  history: [] as Array<{ action: string; detail: string; actionDate: Date }>,
  id: 7,
  isArchived: false,
  lostReason: null as string | null,
  meetingMode: null,
  stage: "NEW" as const,
};

function leadDb(overrides: Record<string, unknown> = {}) {
  return recordingDb({
    "lead.findUnique": BASE_LEAD,
    "lead.update": { ...BASE_LEAD, assignedUser: null, name: "Ann" },
    "leadTask.updateMany": { count: 0 },
    ...overrides,
  });
}

/* ------------------------------------------------------- authorization -- */

test("a customer cannot edit a lead that is not theirs", async () => {
  const recorder = leadDb();
  await assert.rejects(
    () =>
      updateLead(
        customerPrincipal(),
        7,
        { name: "Taken over" },
        recorder.transactionalDb,
      ),
    DomainAuthorizationError,
  );
  // Refused before anything was written, not after.
  assert.deepEqual(recorder.writes(), []);
});

test("a customer may edit the lead assigned to them", async () => {
  const principal = CUSTOMER;
  const recorder = leadDb({
    "lead.findUnique": { ...BASE_LEAD, assignedId: principal.userId },
  });
  const outcome = await updateLead(
    principal,
    7,
    { notes: "Called back" },
    recorder.transactionalDb,
  );
  assert.equal(outcome.lead.id, 7);
});

test("the office reaches every lead; a site manager does not", async () => {
  const outcome = await updateLead(
    adminPrincipal(),
    7,
    { notes: "Site visit booked" },
    leadDb().transactionalDb,
  );
  assert.equal(outcome.lead.id, 7);

  await assert.rejects(
    () =>
      updateLead(
        siteManagerPrincipal(),
        7,
        { notes: "Site visit booked" },
        leadDb().transactionalDb,
      ),
    DomainAuthorizationError,
  );
});

test("an update names a missing lead as missing, not as forbidden", async () => {
  await assert.rejects(
    () =>
      updateLead(
        adminPrincipal(),
        7,
        { notes: "x" },
        recordingDb({ "lead.findUnique": null }).transactionalDb,
      ),
    DomainNotFoundError,
  );
});

test("archiving a lead is staff-only, and never a customer's to do", async () => {
  const principal = CUSTOMER;
  // Even their OWN lead: seeing it is not the same as retiring it.
  const recorder = recordingDb({
    "lead.findUnique": { ...BASE_LEAD, assignedId: principal.userId },
  });
  await assert.rejects(
    () => archiveLead(principal, 7, recorder.db),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);

  const staff = recordingDb({
    "lead.findUnique": { id: 7, isArchived: false },
    "lead.updateMany": { count: 1 },
  });
  assert.deepEqual(await archiveLead(adminPrincipal(), 7, staff.db), {
    alreadyArchived: false,
    id: 7,
  });
});

test("archiving twice is reported, not written twice", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { id: 7, isArchived: true },
  });
  assert.deepEqual(await archiveLead(adminPrincipal(), 7, recorder.db), {
    alreadyArchived: true,
    id: 7,
  });
  assert.deepEqual(recorder.writes(), []);
});

/* ------------------------------------------------------------- the rules -- */

test("a lead cannot be created in a closed stage with no reason", async () => {
  const recorder = recordingDb();
  await assert.rejects(
    () =>
      createLead(
        adminPrincipal(),
        { email: "a@b.com", name: "Ann", stage: "Lost" } as never,
        recorder.transactionalDb,
      ),
    (error) => isLeadValidationError(error),
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a malformed email is refused at the write, not just at the schema", async () => {
  // The booking route reaches this command without parsing createLeadSchema,
  // and only ever null-checked truthiness — a non-empty but malformed address
  // went straight through.
  const recorder = recordingDb();
  await assert.rejects(
    () =>
      createLead(
        adminPrincipal(),
        { email: "not-an-email", name: "Ann" } as never,
        recorder.transactionalDb,
      ),
    (error) => isLeadValidationError(error),
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a lead cannot be moved into a closed stage with no reason", async () => {
  await assert.rejects(
    () =>
      updateLead(
        adminPrincipal(),
        7,
        { stage: "Lost" } as never,
        leadDb().transactionalDb,
      ),
    (error) => isLeadValidationError(error),
  );
});

test("a lead already closed without a reason stays editable", async () => {
  // Those rows predate the rule. Blocking every edit would make them
  // permanently uneditable, including the edit that supplies the reason.
  const recorder = leadDb({
    "lead.findUnique": { ...BASE_LEAD, lostReason: null, stage: "LOST" },
  });
  const outcome = await updateLead(
    adminPrincipal(),
    7,
    { notes: "Tidying up" },
    recorder.transactionalDb,
  );
  assert.equal(outcome.lead.id, 7);
});

test("the duplicate check answers with the existing lead, and writes nothing", async () => {
  const recorder = recordingDb({
    "lead.findFirst": { ...BASE_LEAD, id: 12, name: "Ann" },
  });
  const outcome = await createLead(
    adminPrincipal(),
    { email: "ann@example.com", name: "Ann", phone: "0400000000" } as never,
    recorder.transactionalDb,
  );
  assert.equal(outcome.kind, "duplicate");
  assert.equal(outcome.kind === "duplicate" ? outcome.existing.id : null, 12);
  assert.deepEqual(recorder.writes(), []);

  // The lock is taken BEFORE the read. Without it two submissions of the same
  // public form both read "no existing lead" and both insert.
  const operations = recorder.operations();
  const lastLock = operations.lastIndexOf("$.executeRaw");
  assert.ok(lastLock >= 0, "the dedupe never took an advisory lock");
  assert.ok(
    lastLock < operations.indexOf("lead.findFirst"),
    "the duplicate check runs before the lock it depends on",
  );
});

/* ------------------------------------------- what the adapter is told -- */

test("an edit that does not name an assignee is not a reassignment", async () => {
  // The adapter used to infer this by comparing input.assignedId with the
  // stored one. An absent assignedId is undefined and never equals a real id,
  // so every note and every stage move told the assignee they had just been
  // given a lead they already had.
  const recorder = leadDb({
    "lead.findUnique": { ...BASE_LEAD, assignedId: "user_1" },
  });
  const outcome = await updateLead(
    adminPrincipal(),
    7,
    { notes: "Rang them" },
    recorder.transactionalDb,
  );
  assert.equal(outcome.assignmentChanged, false);
  assert.equal(outcome.previousAssignedId, "user_1");
});

test("re-sending the same assignee is not a reassignment either", async () => {
  const recorder = leadDb({
    "lead.findUnique": { ...BASE_LEAD, assignedId: "user_1" },
  });
  const outcome = await updateLead(
    adminPrincipal(),
    7,
    { assignedId: "user_1", notes: "Rang them" },
    recorder.transactionalDb,
  );
  assert.equal(outcome.assignmentChanged, false);
});

test("a real handover is reported as one, and moves the open tasks", async () => {
  const recorder = leadDb({
    "lead.findUnique": { ...BASE_LEAD, assignedId: "user_1" },
  });
  const outcome = await updateLead(
    adminPrincipal(),
    7,
    { assignedId: "user_2" },
    recorder.transactionalDb,
  );
  assert.equal(outcome.assignmentChanged, true);
  assert.equal(outcome.previousAssignedId, "user_1");

  const reassign = recorder
    .writes()
    .find((call) => call.operation === "leadTask.updateMany");
  assert.ok(reassign, "open tasks were not handed over");
  // Only open ones: a completed task records who actually did the work.
  assert.deepEqual((reassign.args as { where: unknown }).where, {
    completedAt: null,
    leadId: 7,
  });
});

/* -------------------------------------------------------- the adapters -- */

test("the lead adapter and routes go through the shared commands", () => {
  const adapter = read("lib/data/leads.ts");
  for (const command of [
    "createLeadDomain(",
    "updateLeadDomain(",
    "archiveLeadDomain(",
  ]) {
    assert.ok(adapter.includes(command), `${command} is not called`);
  }
  // Its own copies are gone, not left running in parallel.
  assert.doesNotMatch(adapter, /pg_advisory_xact_lock/);
  assert.doesNotMatch(adapter, /resolveLeadStage\(/);
  assert.doesNotMatch(adapter, /dropAlreadyRecorded\(/);
  assert.doesNotMatch(
    adapter,
    /prisma\.lead\.update\(\{ where: \{ id \}, data: \{ isArchived/,
  );
});

test("a failed caller lookup is not permission", () => {
  // isInternalPrincipal is true for the system principal, so falling back to
  // it when Clerk cannot be resolved would turn an outage into full access.
  const source = read("lib/data/current-principal.ts");
  assert.match(source, /const UNIDENTIFIED = anonymousPrincipal\(/);
  assert.doesNotMatch(
    source,
    /catch[\s\S]{0,200}return NO_SESSION;/,
    "a lookup failure falls back to the system principal again",
  );
});
