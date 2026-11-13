import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MilestoneStatus, ProjectStatus, Role } from "@prisma/client";
import { test } from "vitest";

import {
  canEditProject,
  canManageProject,
  projectManageScope,
  projectReadScope,
} from "@/lib/domain/access/projects";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainStaleVersionError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { resolveDueStageClaim } from "@/lib/domain/invoices/stage-claim";
import {
  createMilestone,
  updateMilestone,
} from "@/lib/domain/projects/milestones";
import { getProjectKPIs } from "@/lib/domain/projects/queries";
import {
  isCompleteProjectRequirements,
  mergeProjectRequirementsPatch,
  updateProjectRequirements,
} from "@/lib/domain/projects/requirements";
import { decideVariation } from "@/lib/domain/projects/variations";
import { createProjectUpdate } from "@/lib/domain/projects/resources";
import { anonymousPrincipal, systemPrincipal } from "@/lib/domain/principal";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";
import { ROOT } from "./module-graph";

// Phase 4 of issue #301: projects, milestones, resources and readiness.
//
// These run the commands, they do not read the source. The domain modules are
// Node-safe, which is the whole reason a test can import them — the `"use
// server"` originals could not be loaded by a test runner at all.

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const customerWithAccount = {
  customerId: "cus_1",
  kind: "user" as const,
  role: Role.CUSTOMER,
  userId: "u_c",
};

/* --------------------------------------------------------------- the scopes */

test("read scope is wider than manage scope, and neither is the other", () => {
  // Staff see every project; only an ADMIN or the project's own site manager
  // may act on one.
  assert.deepEqual(projectReadScope(adminPrincipal()), {});
  assert.deepEqual(projectReadScope(siteManagerPrincipal("u_sm")), {});
  assert.deepEqual(projectManageScope(adminPrincipal()), {});
  assert.deepEqual(projectManageScope(siteManagerPrincipal("u_sm")), {
    siteManagerId: "u_sm",
  });
});

test("a customer sees only their own projects", () => {
  assert.deepEqual(projectReadScope(customerWithAccount), {
    customerId: "cus_1",
  });
});

test("a customer account with no customer link matches nothing, not everything", () => {
  // `{ customerId: undefined }` would drop the filter and list every job.
  const scope = projectReadScope(customerPrincipal("u_c"));
  assert.equal(typeof scope.customerId, "string");
  assert.notEqual(scope.customerId, undefined);
  assert.notEqual(scope.customerId, "cus_1");
});

test("nobody signed in sees no projects, and is told so", () => {
  assert.throws(
    () => projectReadScope(anonymousPrincipal("public booking")),
    DomainAuthorizationError,
  );
  assert.throws(
    () => projectManageScope(anonymousPrincipal("public booking")),
    DomainAuthorizationError,
  );
});

test("a cron sees every project on both scopes", () => {
  const cron = systemPrincipal("nightly reconciliation");
  assert.deepEqual(projectReadScope(cron), {});
  assert.deepEqual(projectManageScope(cron), {});
});

test("edit scope keeps the lead's assignee and drops the owning customer", () => {
  // The PATCH route's inline `canEditProject` let the owning CUSTOMER through,
  // and that route accepts totalBudget, startDate and the whole requirements
  // payload — the commercial terms of the client's own build.
  const project = { leadAssignedId: "u_sales", siteManagerId: "u_sm" };

  assert.equal(canEditProject(adminPrincipal(), project), true);
  assert.equal(canEditProject(siteManagerPrincipal("u_sm"), project), true);
  assert.equal(canEditProject(siteManagerPrincipal("u_sales"), project), true);
  assert.equal(canEditProject(siteManagerPrincipal("u_other"), project), false);
  assert.equal(canEditProject(customerWithAccount, project), false);

  // Manage scope never included the assignee, and still does not.
  assert.equal(
    canManageProject(siteManagerPrincipal("u_sales"), {
      id: "p_1",
      siteManagerId: "u_sm",
    }),
    false,
  );
});

/* ------------------------------------------------------------- the KPI tiles */

test("the KPI roll-up counts only what the caller may list", async () => {
  const recorder = recordingDb({
    "project.groupBy": [
      { _count: { _all: 3 }, status: ProjectStatus.ACTIVE },
      { _count: { _all: 2 }, status: ProjectStatus.COMPLETED },
      { _count: { _all: 1 }, status: ProjectStatus.DRAFT },
    ],
    // Drafting: not finished and no activity started (issue #452).
    "project.count": 1,
    // Needs Attention is derived from the records, not the status column.
    "project.findMany": [],
  });

  const kpis = await getProjectKPIs(customerWithAccount, recorder.db);

  assert.deepEqual(kpis, {
    active: 3,
    completed: 2,
    delayed: 0,
    drafting: 1,
    needsAttention: 0,
    onTrack: 0,
    totalActive: 4,
  });

  // The scope reached every query. The raw `SELECT … FROM "Project"` this
  // replaced could not carry one, so the tiles counted every customer's jobs.
  const [call] = recorder.calls;
  assert.equal(call.operation, "project.groupBy");
  assert.deepEqual((call.args as { where: unknown }).where, {
    customerId: "cus_1",
  });
  for (const operation of ["project.count", "project.findMany"]) {
    const scoped = recorder.calls.find((c) => c.operation === operation);
    assert.equal(
      (scoped?.args as { where: { customerId?: string } }).where.customerId,
      "cus_1",
      operation,
    );
  }
});

/* ------------------------------------------------------------- the milestone */

const project = {
  id: "p_1",
  location: "Bondi",
  name: "Job",
  siteManagerId: null,
};

function milestoneDb(script: Record<string, unknown> = {}) {
  return recordingDb({
    "project.findUnique": project,
    "project.update": { siteManagerId: null, spent: "0" },
    ...script,
  });
}

test("an illegal milestone transition is refused before anything is written", async () => {
  const recorder = milestoneDb({
    "milestone.findUnique": { projectId: "p_1" },
    "milestone.findUniqueOrThrow": {
      id: "m_1",
      name: "Slab",
      parentId: null,
      projectId: "p_1",
      status: MilestoneStatus.DONE,
    },
  });

  await assert.rejects(
    () =>
      updateMilestone(
        adminPrincipal(),
        { milestoneId: "m_1", status: MilestoneStatus.PENDING },
        recorder.db,
      ),
    DomainTransitionError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("completing a milestone requires the fields the completion claims", async () => {
  const recorder = milestoneDb({
    "milestone.findUnique": { projectId: "p_1" },
    "milestone.findUniqueOrThrow": {
      id: "m_1",
      name: "Slab",
      parentId: null,
      projectId: "p_1",
      status: MilestoneStatus.ACTIVE,
    },
  });

  await assert.rejects(
    () =>
      updateMilestone(
        adminPrincipal(),
        {
          actualDate: "2026-02-01",
          milestoneId: "m_1",
          startDate: "2026-01-01",
          status: MilestoneStatus.DONE,
        },
        recorder.db,
      ),
    (error: unknown) =>
      error instanceof DomainValidationError && error.field === "spend",
  );
  assert.deepEqual(recorder.writes(), []);
});

test("settling a milestone recomputes the project's spend and status", async () => {
  // Eve's `updateMilestoneDirect` wrote the milestone row and stopped: no
  // parent roll-up, no project spend, no status, no claim.
  const recorder = milestoneDb({
    "invoice.findUnique": null,
    "milestone.aggregate": { _sum: { spend: "12500" } },
    "milestone.count": 0,
    "milestone.findMany": [],
    "milestone.findUnique": { projectId: "p_1" },
    "milestone.findUniqueOrThrow": {
      id: "m_1",
      name: "Slab",
      parentId: null,
      projectId: "p_1",
      status: MilestoneStatus.ACTIVE,
    },
    "milestone.update": {
      actualDate: new Date("2026-02-01"),
      budget: { toString: () => "12500" },
      id: "m_1",
      name: "Slab",
      parentId: null,
      projectId: "p_1",
      spend: { toString: () => "12500" },
      startDate: new Date("2026-01-01"),
      status: MilestoneStatus.DONE,
      targetDate: new Date("2026-02-01"),
    },
    "project.update": { siteManagerId: "u_sm", spent: "12500" },
    // Settling the milestone settles its bookings; this one holds none.
    "tradieSchedule.findMany": [],
  });

  const outcome = await updateMilestone(
    adminPrincipal(),
    {
      actualDate: "2026-02-01",
      milestoneId: "m_1",
      spend: 12500,
      startDate: "2026-01-01",
      status: MilestoneStatus.DONE,
    },
    recorder.db,
  );

  assert.equal(outcome.statusChanged, true);
  assert.equal(outcome.projectSpent, "12500");
  // No milestone is left PENDING, so the build is finished.
  assert.equal(outcome.projectStatus, ProjectStatus.COMPLETED);

  const updatedProject = recorder
    .writes()
    .find((call) => call.operation === "project.update");
  assert.ok(updatedProject, "the project's spend was never recomputed");
});

test("a new milestone cannot hang off another project's parent", async () => {
  const recorder = recordingDb({
    "milestone.findFirst": null,
    "project.findUnique": project,
  });

  await assert.rejects(
    () =>
      createMilestone(
        adminPrincipal(),
        {
          budget: 1000,
          name: "Extra inspection",
          parentId: "m_from_another_project",
          projectId: "p_1",
          projectStage: "Slab",
          targetDate: "2026-03-01",
        },
        recorder.db,
      ),
    DomainNotFoundError,
  );
  // Eve checked this; the App did not, and wrote the row anyway.
  assert.deepEqual(recorder.writes(), []);
});

test("a milestone is inserted under its parent, not appended to the project", async () => {
  const recorder = recordingDb({
    "milestone.create": {
      budget: { toString: () => "1000" },
      id: "m_new",
      name: "Extra inspection",
      order: 6,
      parentId: "m_parent",
      projectId: "p_1",
      spend: null,
    },
    "milestone.findFirst": {
      childrenMilestones: [{ order: 4 }, { order: 5 }],
      order: 3,
      status: MilestoneStatus.PENDING,
    },
    "milestone.findMany": [{ id: "m_after", order: 6 }],
    "project.findUnique": project,
  });

  await createMilestone(
    adminPrincipal(),
    {
      budget: 1000,
      name: "Extra inspection",
      parentId: "m_parent",
      projectId: "p_1",
      projectStage: "Slab",
      targetDate: "2026-03-01",
    },
    recorder.db,
  );

  // Eve appended at `last.order + 1` and shifted nothing, so an activity added
  // to a parent landed at the bottom of the project.
  const shift = recorder
    .writes()
    .find((call) => call.operation === "milestone.update");
  assert.ok(shift, "the rows below the insertion point were never shifted");
  assert.deepEqual((shift.args as { data: unknown }).data, { order: 7 });

  const created = recorder
    .writes()
    .find((call) => call.operation === "milestone.create");
  assert.equal((created!.args as { data: { order: number } }).data.order, 6);
});

/* ------------------------------------------------------------- stage claims */

test("a stage that is entirely waived raises no claim", async () => {
  const recorder = recordingDb({
    "milestone.findMany": [
      {
        actualDate: new Date("2026-01-10"),
        id: "m_1",
        name: "Deposit",
        order: 1,
        parentId: null,
        projectStage: "Deposit",
        status: MilestoneStatus.NOT_REQUIRED,
        targetDate: new Date("2026-01-10"),
      },
    ],
  });

  assert.equal(
    await resolveDueStageClaim(
      { milestoneId: "m_1", projectId: "p_1" },
      recorder.db,
    ),
    null,
  );
  // Never reached the invoice table: nothing was earned, so nothing is owed.
  assert.deepEqual(recorder.operations(), ["milestone.findMany"]);
});

test("a completed, unclaimed stage is reported as due exactly once", async () => {
  const milestones = [
    {
      actualDate: new Date("2026-01-10"),
      id: "m_1",
      name: "Deposit",
      order: 1,
      parentId: null,
      projectStage: "Deposit",
      status: MilestoneStatus.DONE,
      targetDate: new Date("2026-01-10"),
    },
  ];

  const due = recordingDb({
    "invoice.findUnique": null,
    "milestone.findMany": milestones,
  });
  assert.deepEqual(
    await resolveDueStageClaim(
      { milestoneId: "m_1", projectId: "p_1" },
      due.db,
    ),
    { projectId: "p_1", projectStage: "Deposit" },
  );

  // Already claimed: a second settlement in the same stage must not bill twice.
  const claimed = recordingDb({
    "invoice.findUnique": { id: "inv_1" },
    "milestone.findMany": milestones,
  });
  assert.equal(
    await resolveDueStageClaim(
      { milestoneId: "m_1", projectId: "p_1" },
      claimed.db,
    ),
    null,
  );
});

/* -------------------------------------------------------------- variations */

test("a decided variation cannot be decided again", async () => {
  // Approving twice used to re-stamp approvedDate and shift every pending
  // milestone a second time — a double-click moved the whole programme out.
  const recorder = recordingDb({
    "project.findUnique": project,
    "variation.findFirst": {
      cost: { toString: () => "5000" },
      delayDays: 3,
      description: "Extra window",
      id: "v_1",
      requestedDate: new Date("2026-01-01"),
      status: "APPROVED",
    },
  });

  await assert.rejects(
    () =>
      decideVariation(
        adminPrincipal(),
        { decision: "APPROVED", projectId: "p_1", variationId: "v_1" },
        recorder.db,
      ),
    DomainTransitionError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a variation from another project is not found, not approved", async () => {
  const recorder = recordingDb({
    "project.findUnique": project,
    "variation.findFirst": null,
  });

  await assert.rejects(
    () =>
      decideVariation(
        adminPrincipal(),
        { decision: "APPROVED", projectId: "p_1", variationId: "v_elsewhere" },
        recorder.db,
      ),
    DomainNotFoundError,
  );
  assert.deepEqual(recorder.writes(), []);
});

/* ----------------------------------------------------------- site updates */

test("a site update cannot settle another project's milestone", async () => {
  const recorder = recordingDb({
    "milestone.findFirst": null,
    "project.findUnique": project,
  });

  await assert.rejects(
    () =>
      createProjectUpdate(
        adminPrincipal(),
        {
          milestoneId: "m_elsewhere",
          notes: "Slab poured",
          projectId: "p_1",
        },
        recorder.db,
      ),
    DomainNotFoundError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a site update needs a real author", async () => {
  // `SiteUpdate.authorId` is non-null: a cron posting one would fail on the
  // foreign key halfway through the transaction.
  const recorder = recordingDb({ "project.findUnique": project });

  await assert.rejects(
    () =>
      createProjectUpdate(
        systemPrincipal("nightly job"),
        { notes: "Slab poured", projectId: "p_1" },
        recorder.db,
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

/* ------------------------------------------------------------ requirements */

const completeRequirements = {
  automationTriggers: {
    noticeCountdowns: true,
    orderReminders: true,
    rainDelayCalculations: true,
  },
  commercialsAndClaims: { totalContractSum: 500_000 },
  conflicts: [],
  inclusionsAndExclusions: { exclusions: [], inclusions: [] },
  legalAdministration: { signedDate: "2026-01-01" },
  projectName: "Job",
  projectType: "Granny flat",
  safetyAndSiteLogistics: {},
  sourceDocuments: {},
  subStructureAndGround: {},
  summary: "",
  utilityInfrastructure: {},
  validations: [],
  version: 1,
  wetAreaCompliance: {},
};

test("an incomplete payload is not silently patched", () => {
  assert.equal(isCompleteProjectRequirements(completeRequirements), true);

  const missingSection = { ...completeRequirements };
  delete (missingSection as Record<string, unknown>).wetAreaCompliance;
  assert.equal(isCompleteProjectRequirements(missingSection), false);
});

test("a patch merges objects key by key and replaces arrays wholesale", () => {
  const merged = mergeProjectRequirementsPatch(completeRequirements as never, {
    inclusionsAndExclusions: { inclusions: ["Driveway"] },
    legalAdministration: { pcaInspector: "A. Inspector" },
  }) as unknown as typeof completeRequirements & {
    legalAdministration: { pcaInspector: string; signedDate: string };
  };

  // The untouched key survives the merge…
  assert.equal(merged.legalAdministration.signedDate, "2026-01-01");
  assert.equal(merged.legalAdministration.pcaInspector, "A. Inspector");
  // …and the array is replaced, not concatenated.
  assert.deepEqual(merged.inclusionsAndExclusions.inclusions, ["Driveway"]);
});

test("a requirements save that lost the race is refused, not applied", async () => {
  // The App PATCH route had no version check at all: two tabs on the Overview,
  // or one tab retried after a timeout, and the second save overwrote the
  // first with no sign anything had happened.
  const recorder = recordingDb({
    "project.findUnique": {
      requirements: completeRequirements,
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    "project.updateMany": { count: 0 },
  });

  await assert.rejects(
    () =>
      updateProjectRequirements(
        systemPrincipal("test"),
        {
          expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
          patch: { legalAdministration: { pcaInspector: "A. Inspector" } },
          projectId: "p_1",
        },
        recorder.db,
      ),
    DomainStaleVersionError,
  );
});

test("the optimistic guard is in the where clause, not read-then-write", async () => {
  const recorder = recordingDb({
    "project.findUnique": {
      requirements: completeRequirements,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    "project.findUniqueOrThrow": {
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    },
    "project.updateMany": { count: 1 },
  });

  const result = await updateProjectRequirements(
    systemPrincipal("test"),
    {
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      patch: { legalAdministration: { pcaInspector: "A. Inspector" } },
      projectId: "p_1",
    },
    recorder.db,
  );

  assert.deepEqual(result.changedSections, ["legalAdministration"]);

  const [write] = recorder.writes();
  assert.equal(write.operation, "project.updateMany");
  assert.deepEqual((write.args as { where: unknown }).where, {
    id: "p_1",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
});

/* ------------------------------------------- the old implementations are gone */

test("the Eve specialist no longer carries its own project or milestone rules", () => {
  const specialist = read("agent/lib/project-operations.ts");

  for (const gone of [
    "async function createMilestoneDirect",
    "async function updateMilestoneDirect",
    "async function updateProjectRequirementsDirect",
    "function validateProjectRequirements",
    "function mergeProjectRequirementsPatch",
    "const milestoneTransitions",
  ]) {
    assert.equal(
      specialist.includes(gone),
      false,
      `${gone} is still in the Eve specialist — one rule, not two.`,
    );
  }

  // And the inline scope it used instead of the shared one.
  assert.doesNotMatch(specialist, /siteManagerId: actor\.id/);
});

test("the app milestone and project writers are adapters over the domain", () => {
  const milestones = read("lib/data/milestones.ts");
  assert.match(milestones, /from "@\/lib\/domain\/projects\/milestones"/);
  // The state machine lived here as MILESTONE_STATE_MACHINE.
  assert.doesNotMatch(milestones, /MILESTONE_STATE_MACHINE/);

  const projects = read("lib/data/projects.ts");
  assert.match(projects, /from "@\/lib\/domain\/projects\/queries"/);
  // The includes, the progress arithmetic and the raw KPI query are gone.
  assert.doesNotMatch(projects, /\$queryRaw/);
  assert.doesNotMatch(projects, /projectDetailInclude/);
});

test("the customer and site-manager modules are no longer Server Actions", () => {
  // Every export was a POST endpoint; `findCustomerById` and
  // `getSiteManagerById` answered a whole record to any signed-in caller.
  for (const path of ["lib/data/customers.ts", "lib/data/siteManagers.ts"]) {
    assert.doesNotMatch(read(path), /^["']use server["']/m, path);
    assert.match(read(path), /^import "server-only";/m, path);
  }
});

/* ------------------------------------------------------- project creation */

test("a converted lead is born DRAFT, not ACTIVE", async () => {
  // `Project.status @default(DRAFT)` replaced ACTIVE because a project with no
  // certifier, no compliance file and no milestone underway is not active in
  // any sense a site manager would recognise. The command must therefore leave
  // `status` OFF, not set ACTIVE — the readiness gate asks its question
  // against ACTIVE ("what stands between this and going on site?"), which is
  // not the same as asserting the build has started.
  const creation = read("lib/domain/projects/creation.ts");
  const body = creation.slice(
    creation.indexOf("export async function createProjectFromLead"),
  );
  const create = body.slice(body.indexOf("db.project.create("));
  const data = create.slice(0, create.indexOf("select:"));

  assert.doesNotMatch(
    data,
    /status: ProjectStatus\.ACTIVE/,
    "a converted lead must not be created ACTIVE",
  );
  // Nor NEEDS_ATTENTION (issue #452): attention is derived live from the
  // project's records, and writing it here replaced the lifecycle stage.
  assert.doesNotMatch(data, /ProjectStatus\.NEEDS_ATTENTION/);
});

test("the wizard binds a typed refusal to the field that caused it", () => {
  // Phase 4's command throws DomainErrors; failureFromThrownError used to match
  // on sentinel substrings only, so "That site manager could not be found."
  // fell through to SERVER_ERROR with no field binding.
  const mapper = read("lib/projects/create-project-errors.ts");
  assert.match(mapper, /const domain = domainFailure\(error\);/);
  assert.match(mapper, /error instanceof DomainNotFoundError/);
  assert.match(mapper, /error instanceof DomainTransitionError/);
});
