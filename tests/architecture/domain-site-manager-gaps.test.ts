import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ComplianceDocumentType,
  MilestoneStatus,
  ProjectStatus,
  Role,
} from "@prisma/client";
import { test } from "vitest";

import {
  DomainAuthorizationError,
  DomainTransitionError,
} from "@/lib/domain/errors";
import {
  changeTeamMemberRole,
  checkTeamMemberRoleChange,
} from "@/lib/domain/identity/team";
import { readProjectAttention } from "@/lib/domain/projects/attention";
import { getProjectRequirements } from "@/lib/domain/projects/requirements";
import {
  assertCanMoveComplianceFile,
  deleteSupersededComplianceFiles,
} from "@/lib/domain/compliance/file-ownership";
import { calculateFollowUpBadgeLabel } from "@/components/dashboard/dashboard-follow-ups";
import { anonymousPrincipal, systemPrincipal } from "@/lib/domain/principal";
import {
  filterOfficeUserIds,
  listOfficeNotificationRecipients,
} from "@/lib/domain/identity/users";
import {
  getHbcfBreachForProject,
  getHbcfTimelineForLead,
} from "@/lib/domain/insurance/hbcf";
import { createLead, updateLead } from "@/lib/domain/leads/commands";
import { updateProject } from "@/lib/domain/projects/commands";
import {
  hideRequirementsFinancials,
  withStoredHbcf,
} from "@/lib/domain/projects/financial-redaction";
import {
  assertCanFileComplianceDocument,
  assertCanRecordHbcf,
} from "@/lib/domain/access/projects";
import { updateMilestone } from "@/lib/domain/projects/milestones";
import { listTradieActivity } from "@/lib/domain/tradies/queries";
import { isLeadValidationError } from "@/lib/leads/lead-validation-error";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import type { CreateLeadInput, UpdateLeadInput } from "@/utils/validators";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";
import { REPO_ROOT } from "../support/repo-root";

// The second pass over PR #559: the places a site manager still reached the
// sales side or project money after the first one. Each refusal is checked
// with the database untouched, because a refusal that wrote first is not one.

const SM = "user_sm";

/* ---------------------------------------------------------- leads -- */

test("a site manager cannot add a lead, and the duplicate lookup never runs", async () => {
  // The duplicate answer hands back the existing lead's contact details,
  // notes and emails, so the refusal has to come before it.
  const recorder = recordingDb();
  await assert.rejects(
    createLead(
      siteManagerPrincipal(SM),
      { email: "x@example.com", name: "X" } as CreateLeadInput,
      recorder.transactionalDb,
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.operations(), []);
});

test("a lead cannot be assigned to a site manager, on create or on edit", async () => {
  const siteManagerRow = { "user.findUnique": { role: Role.SITE_MANAGER } };

  const onCreate = recordingDb(siteManagerRow);
  await assert.rejects(
    createLead(
      adminPrincipal(),
      { assignedId: SM, email: "x@example.com", name: "X" } as CreateLeadInput,
      onCreate.transactionalDb,
    ),
    isLeadValidationError,
  );
  assert.deepEqual(onCreate.writes(), []);

  const onEdit = recordingDb({
    ...siteManagerRow,
    "lead.findUnique": { assignedId: null, id: 1 },
  });
  await assert.rejects(
    updateLead(
      adminPrincipal(),
      1,
      { assignedId: SM } as UpdateLeadInput,
      onEdit.transactionalDb,
    ),
    isLeadValidationError,
  );
  assert.deepEqual(onEdit.writes(), []);
});

test("the public booking route and the inbound webhook still get past the create gate", async () => {
  // Anonymous and system callers are the front door. Driving the whole create
  // is the integration tests' job; reaching the assignee check proves the new
  // gate let them through.
  for (const principal of [
    anonymousPrincipal("booking"),
    systemPrincipal("graph:inbound-lead"),
  ]) {
    const recorder = recordingDb({
      "user.findUnique": { role: Role.SITE_MANAGER },
    });
    await assert.rejects(
      createLead(
        principal,
        {
          assignedId: SM,
          email: "x@example.com",
          name: "X",
        } as CreateLeadInput,
        recorder.transactionalDb,
      ),
      isLeadValidationError,
    );
  }
});

/* ----------------------------------------------------------- HBCF -- */

test("the HBCF pool refuses a site manager before reading it", async () => {
  const recorder = recordingDb();
  await assert.rejects(
    getHbcfTimelineForLead(siteManagerPrincipal(SM), 1, recorder.db),
    DomainAuthorizationError,
  );
  await assert.rejects(
    getHbcfBreachForProject(siteManagerPrincipal(SM), "p_1", recorder.db),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.operations(), []);
});

const CONFIRMED = {
  amountConfirmed: true,
  certificateNumber: "C1",
  claimAmount: 450000,
  coverStartDate: null,
  fileId: "f_1",
  fileName: "hbcf.pdf",
  url: "https://blob/hbcf.pdf",
};

test("HBCF claim amounts are blanked for someone who may not see money", () => {
  const hidden = hideRequirementsFinancials({
    commercialsAndClaims: {},
    legalAdministration: {
      hbcfClaimDocuments: [CONFIRMED],
      hbcfInsuranceNumber: "C1",
    },
  } as unknown as ProjectRequirementsPayload);
  // The certificate itself stays openable: a site manager checks it on site.
  assert.deepEqual(hidden?.legalAdministration.hbcfClaimDocuments, [
    { ...CONFIRMED, claimAmount: null },
  ]);
  assert.equal(hidden?.legalAdministration.hbcfInsuranceNumber, "C1");
});

const COMPLETE_REQUIREMENTS = {
  automationTriggers: {
    noticeCountdowns: true,
    orderReminders: true,
    rainDelayCalculations: true,
  },
  commercialsAndClaims: { totalContractSum: 500_000 },
  conflicts: [],
  inclusionsAndExclusions: { exclusions: [], inclusions: [] },
  legalAdministration: { hbcfClaimDocuments: [CONFIRMED] },
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

test("the agent's requirements read is redacted like the screens", async () => {
  const read = (principal: Parameters<typeof getProjectRequirements>[0]) =>
    getProjectRequirements(
      principal,
      "p_1",
      recordingDb({
        "project.findUnique": {
          id: "p_1",
          requirements: COMPLETE_REQUIREMENTS,
          updatedAt: new Date("2026-11-20T00:00:00.000Z"),
        },
      }).db,
    );

  const hidden = (await read(siteManagerPrincipal(SM))).requirements;
  assert.equal(hidden.commercialsAndClaims.totalContractSum, null);
  assert.equal(
    hidden.legalAdministration.hbcfClaimDocuments?.[0]?.claimAmount,
    null,
  );
  const shown = (await read(adminPrincipal())).requirements;
  assert.equal(shown.commercialsAndClaims.totalContractSum, 500_000);
});

const UNCONFIRMED = {
  ...CONFIRMED,
  amountConfirmed: false,
  claimAmount: 1200,
  fileId: "f_3",
};

const STORED_LEGAL = {
  hbcfClaimDocuments: [CONFIRMED, UNCONFIRMED],
  hbcfInsuranceDocument: { fileId: "f_1", fileName: "hbcf.pdf", url: "u" },
  hbcfInsuranceNumber: "C1",
  siteAddress: "1 Site St",
};

/** A site manager's project save of this legal section; what was stored. */
async function siteManagerSavesLegal(legal: Record<string, unknown>) {
  const recorder = recordingDb({
    "milestone.count": 0,
    "milestone.findMany": [],
    "project.findUnique": {
      customerId: null,
      id: "p_1",
      Lead: null,
      location: "1 Site St",
      name: "Smith residence",
      siteManagerId: SM,
    },
    "project.findUniqueOrThrow": {
      requirements: { legalAdministration: STORED_LEGAL },
      startDate: new Date("2026-06-01T00:00:00.000Z"),
      status: ProjectStatus.ON_TRACK,
    },
  });

  await updateProject(
    siteManagerPrincipal(SM),
    { projectId: "p_1", requirements: { legalAdministration: legal } },
    recorder.db,
  );

  const write = recorder
    .writes()
    .find((call) => call.operation === "project.update")?.args as {
    data: { requirements: { legalAdministration: Record<string, unknown> } };
  };
  return write.data.requirements.legalAdministration;
}

const STORED_HBCF = {
  hbcfClaimDocuments: STORED_LEGAL.hbcfClaimDocuments,
  hbcfInsuranceDocument: STORED_LEGAL.hbcfInsuranceDocument,
  hbcfInsuranceNumber: STORED_LEGAL.hbcfInsuranceNumber,
};
const hbcfOf = (legal: Record<string, unknown>) => ({
  hbcfClaimDocuments: legal.hbcfClaimDocuments,
  hbcfInsuranceDocument: legal.hbcfInsuranceDocument,
  hbcfInsuranceNumber: legal.hbcfInsuranceNumber,
});

test("a site manager's project save cannot change anything HBCF (#560)", async () => {
  // HBCF is recorded by the office. Whatever the save carries for it — a
  // zeroed amount, an edited certificate number (which would make the pool
  // drop a document as a duplicate), a removed or added document, a null — the
  // stored HBCF fields are what is written.
  for (const attempt of [
    {
      hbcfClaimDocuments: [
        { ...CONFIRMED, certificateNumber: "C9", claimAmount: 0 },
        UNCONFIRMED,
      ],
      hbcfInsuranceNumber: "changed",
    },
    { hbcfClaimDocuments: [] },
    { hbcfClaimDocuments: null, hbcfInsuranceDocument: null },
    {
      hbcfClaimDocuments: [
        ...STORED_LEGAL.hbcfClaimDocuments,
        { ...CONFIRMED, fileId: "f_new" },
      ],
    },
    {},
  ]) {
    const saved = await siteManagerSavesLegal({
      ...attempt,
      siteAddress: "2 New St",
    });
    assert.deepEqual(hbcfOf(saved), STORED_HBCF, JSON.stringify(attempt));
    // The rest of the section is theirs to edit.
    assert.equal(saved.siteAddress, "2 New St");
  }
});

test("a field the project never had is not created by a site manager's save", () => {
  assert.deepEqual(
    withStoredHbcf({ hbcfInsuranceNumber: "C1", siteAddress: "x" }, {}),
    { siteAddress: "x" },
  );
});

test("the HBCF upload refuses a site manager; the office may record it", () => {
  assert.throws(
    () => assertCanRecordHbcf(siteManagerPrincipal(SM)),
    DomainAuthorizationError,
  );
  assert.doesNotThrow(() => assertCanRecordHbcf(adminPrincipal()));
});

test("only the office files an HBCF certificate on the compliance file", () => {
  assert.throws(
    () =>
      assertCanFileComplianceDocument(
        siteManagerPrincipal(SM),
        ComplianceDocumentType.HOME_INSURANCE,
      ),
    DomainAuthorizationError,
  );
  // Every other document is still the site manager's to file.
  assert.doesNotThrow(() =>
    assertCanFileComplianceDocument(
      siteManagerPrincipal(SM),
      ComplianceDocumentType.SURVEY,
    ),
  );
  assert.doesNotThrow(() =>
    assertCanFileComplianceDocument(
      adminPrincipal(),
      ComplianceDocumentType.HOME_INSURANCE,
    ),
  );
});

test("every road onto the compliance file checks the HBCF rule before it writes", () => {
  // The upload, Identify and prior-compliance routes all meet in
  // attachComplianceDocumentFile; discovery claims files on its own.
  const source = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
  const before = (text: string, first: string, second: string) => {
    const a = text.indexOf(first);
    const b = text.indexOf(second, a);
    assert.ok(a >= 0 && b > a, `${first} must come before ${second}`);
  };
  const RULE = "assertCanFileComplianceDocument(";

  const data = source("lib/data/compliance.ts");
  const attach = data.slice(
    data.indexOf("export async function attachComplianceDocumentFile"),
  );
  before(attach, RULE, "tx.complianceDocument.create");
  const prior = data.slice(
    data.indexOf("export async function recordPriorComplianceDocument"),
  );
  before(prior, RULE, "openPriorComplianceFile(");

  const discover = source(
    "app/api/(data)/projects/[projectId]/compliance/discover/route.ts",
  );
  before(discover, RULE, "await claim(");
});

test("a site manager cannot move the project's HBCF file onto another row", async () => {
  // Attaching moves a file off its row, and replacing it later deletes it.
  const move = (
    principal: Parameters<typeof assertCanMoveComplianceFile>[0],
    reads: Record<string, unknown>,
  ) => {
    const recorder = recordingDb(reads);
    return {
      recorder,
      run: assertCanMoveComplianceFile(
        principal,
        { fileId: "f_1", projectId: "p_1" },
        recorder.db,
      ),
    };
  };
  const onInsuranceRow = {
    "file.findUnique": {
      complianceDocument: {
        documentType: ComplianceDocumentType.HOME_INSURANCE,
      },
    },
    "project.findUnique": { requirements: {} },
  };
  const onOverview = {
    "file.findUnique": { complianceDocument: null },
    "project.findUnique": {
      requirements: { legalAdministration: STORED_LEGAL },
    },
  };

  for (const reads of [onInsuranceRow, onOverview]) {
    const { recorder, run } = move(siteManagerPrincipal(SM), reads);
    await assert.rejects(run, DomainAuthorizationError);
    assert.deepEqual(recorder.writes(), []);
    await assert.doesNotReject(move(adminPrincipal(), reads).run);
  }

  // Any other file is still theirs to place.
  await assert.doesNotReject(
    move(siteManagerPrincipal(SM), {
      "file.findUnique": { complianceDocument: null },
      "project.findUnique": { requirements: {} },
    }).run,
  );
});

test("replacing the HBCF certificate refuses a site manager before anything is deleted", async () => {
  const replace = (
    principal: Parameters<typeof assertCanMoveComplianceFile>[0],
  ) => {
    const recorder = recordingDb({
      "file.findMany": [{ id: "f_old", url: "https://blob.example/old.pdf" }],
      "file.findUnique": {
        complianceDocument: {
          documentType: ComplianceDocumentType.HOME_INSURANCE,
        },
      },
      "project.findUnique": { requirements: {} },
    });
    return {
      recorder,
      run: deleteSupersededComplianceFiles(
        principal,
        { documentId: "d_1", keepFileId: "f_new", projectId: "p_1" },
        recorder.db,
      ),
    };
  };

  const refused = replace(siteManagerPrincipal(SM));
  await assert.rejects(refused.run, DomainAuthorizationError);
  assert.deepEqual(refused.recorder.writes(), []);

  const allowed = replace(adminPrincipal());
  assert.deepEqual(await allowed.run, [
    { id: "f_old", url: "https://blob.example/old.pdf" },
  ]);
  assert.deepEqual(
    allowed.recorder.writes().map((write) => write.operation),
    ["file.deleteMany"],
  );
});

/* ---------------------------------------------------------- spend -- */

test("a site manager correcting a done activity's date keeps the spend the office recorded", async () => {
  // No bookings, so re-pricing would have written $0 over the office's figure.
  const done = {
    actualDate: new Date("2026-11-18T00:00:00.000Z"),
    budget: "0",
    id: "activity",
    parentId: null,
    projectId: "project",
    spend: "2500",
    status: MilestoneStatus.DONE,
  };
  const recorder = recordingDb({
    "milestone.aggregate": { _sum: { spend: null } },
    "milestone.count": 0,
    "milestone.findMany": [],
    "milestone.findUnique": { parentId: null, projectId: "project" },
    "milestone.findUniqueOrThrow": { ...done, childrenMilestones: [] },
    "milestone.update": done,
    "milestone.updateMany": { count: 0 },
    "project.findUnique": { id: "project", siteManagerId: SM },
    "project.update": { siteManagerId: SM, spent: "0" },
    "tradieSchedule.findMany": [],
    "tradieSchedule.updateMany": { count: 0 },
  });

  await updateMilestone(
    siteManagerPrincipal(SM),
    {
      actualDate: "2026-11-20",
      milestoneId: "activity",
      spend: 0,
      startDate: "2026-11-10",
      status: MilestoneStatus.DONE,
    },
    recorder.db,
  );

  const write = recorder
    .writes()
    .find((call) => call.operation === "milestone.update")?.args as {
    data: { spend?: { toString(): string } };
  };
  assert.equal(String(write.data.spend), "2500");
});

/* -------------------------------------------------- notifications -- */

test("a broadcast and a variation notification reach the office only", async () => {
  const recorder = recordingDb({ "user.findMany": [] });

  await listOfficeNotificationRecipients(recorder.db);
  assert.deepEqual(await filterOfficeUserIds([SM, null, SM], recorder.db), []);

  const officeOnly = { in: [Role.ADMIN, Role.GUEST] };
  const [broadcast, filtered] = recorder.calls as unknown as {
    args: { where: { role: unknown; id?: unknown } };
  }[];
  assert.deepEqual(broadcast.args.where.role, officeOnly);
  assert.deepEqual(filtered.args.where, { id: { in: [SM] }, role: officeOnly });
});

test("filtering no recipients reads nothing, so nobody is broadcast to by accident", async () => {
  const recorder = recordingDb();
  assert.deepEqual(await filterOfficeUserIds([null, " "], recorder.db), []);
  assert.deepEqual(recorder.operations(), []);
});

/* --------------------------------------------------------- tradies -- */

test("the tradie page's description does not carry the tradie's quoted price", () => {
  // Page metadata reaches anyone who can open the page, a site manager too.
  const page = readFileSync(
    join(REPO_ROOT, "app/(main)/tradie-management/[id]/page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(page, /Last quoted price/i);
});

test("a tradie's activity history (quotes and invoices) refuses a site manager", async () => {
  const refused = recordingDb();
  await assert.rejects(
    listTradieActivity(
      siteManagerPrincipal(SM),
      { tradieId: "t_1" },
      refused.db,
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(refused.operations(), []);

  const allowed = recordingDb({ "tradieActivityLog.findMany": [] });
  const page = await listTradieActivity(
    adminPrincipal(),
    { tradieId: "t_1" },
    allowed.db,
  );
  assert.deepEqual(page.items, []);
});

/* ------------------------------------------------- role changes -- */

const ROLE_CHANGE = {
  expectedRole: Role.ADMIN,
  newRole: Role.SITE_MANAGER,
  userId: "u_1",
};

test("someone still holding leads cannot be moved out of the office", async () => {
  // Whoever holds a lead can open it, and the reminders email them the
  // client's details. The office reassigns first.
  const recorder = recordingDb({
    "lead.count": 2,
    "leadTask.count": 1,
    "user.count": 3,
    "user.findUnique": { id: "u_1", name: "Sam", role: Role.ADMIN },
  });
  await assert.rejects(
    changeTeamMemberRole(
      adminPrincipal(),
      ROLE_CHANGE,
      recorder.transactionalDb,
    ),
    (error) => {
      assert.ok(error instanceof DomainTransitionError);
      assert.match(
        error.message,
        /Sam still has 2 leads and 1 open lead task assigned\. Reassign them/,
      );
      return true;
    },
  );
  assert.deepEqual(recorder.writes(), []);
});

test("someone holding nothing moves to site manager as before", async () => {
  const recorder = recordingDb({
    "lead.count": 0,
    "leadTask.count": 0,
    "user.count": 3,
    "user.findUnique": { id: "u_1", name: "Sam", role: Role.ADMIN },
    "user.updateMany": { count: 1 },
  });
  const changed = await changeTeamMemberRole(
    adminPrincipal(),
    ROLE_CHANGE,
    recorder.transactionalDb,
  );
  assert.equal(changed.role, Role.SITE_MANAGER);
});

test("a refused role change is checked before Clerk hears of it", async () => {
  // Clerk's user.updated webhook writes the role straight to the database, so
  // a change published to Clerk and then refused could still land.
  const recorder = recordingDb({
    "lead.count": 1,
    "leadTask.count": 0,
    "user.count": 3,
    "user.findUnique": { id: "u_1", name: "Sam", role: Role.ADMIN },
  });
  await assert.rejects(
    checkTeamMemberRoleChange(
      adminPrincipal(),
      { newRole: Role.SITE_MANAGER, userId: "u_1" },
      recorder.db,
    ),
    DomainTransitionError,
  );
  assert.deepEqual(recorder.writes(), []);

  const route = readFileSync(
    join(REPO_ROOT, "app/api/(data)/users/route.ts"),
    "utf8",
  );
  const patch = route.slice(route.indexOf("export async function PATCH"));
  const checked = patch.indexOf("checkTeamMemberRoleChange(");
  assert.ok(
    checked > 0 && checked < patch.indexOf("clerkClient.users.updateUser("),
    "the role is published to Clerk before it is checked",
  );
  // And every cached copy of the user forgets the old role.
  assert.match(patch, /revalidateTag\(`user-\$\{userId\}`/);
});

/* ------------------------------------------------ public booking -- */

test("the booking page writes its lead as the booking, whoever is signed in", () => {
  // A client signed in to the app in the same browser was refused ("only the
  // office adds a lead") after their invitation had gone out, and an
  // anonymous client could not update their own lead.
  const route = readFileSync(
    join(REPO_ROOT, "app/api/graph/book-consultant/route.ts"),
    "utf8",
  );
  assert.match(route, /systemPrincipal\("graph:public-booking"\)/);
  assert.equal(route.match(/principal: BOOKING_WRITER/g)?.length, 2);
});

test("a signed-in GUEST still reaches the booking page and its two APIs, and nothing else", () => {
  // GUEST is Clerk's default for a new account, a client among them. The
  // proxy used to send every GUEST request to /guest, the booking page
  // included. The exemption is the booking routes only: Eve's channel is also
  // a public route, and admits any office role, GUEST included.
  const proxy = readFileSync(join(REPO_ROOT, "proxy.ts"), "utf8");
  const start = proxy.indexOf(
    "const isPublicBookingRoute = createRouteMatcher([",
  );
  const booking = proxy.slice(start, proxy.indexOf("]);", start));
  assert.ok(start >= 0, "no booking route matcher");
  for (const route of [
    '"/book-consultation"',
    '"/api/graph/book-consultant(.*)"',
    '"/api/graph/read-calender-dateTime(.*)"',
  ]) {
    assert.ok(booking.includes(route), `${route} is not exempt`);
  }
  assert.ok(!booking.includes("/eve"), "Eve's channel is exempt");
  assert.match(
    proxy,
    /role === "GUEST"\s*&& !isPublicBookingRoute\(request\)/,
    "the GUEST redirect does not exempt the booking routes",
  );
});

/* ------------------------------------------------- project alerts -- */

test("a site manager is not alerted to pending variations; the office is", async () => {
  const row = {
    certifierEngagement: null,
    checklists: [],
    customer: { name: "Sam Smith" },
    id: "p1",
    location: "1 Example St",
    milestones: [],
    name: "Smith residence",
    requirements: null,
    status: ProjectStatus.ON_TRACK,
    tradieSchedules: [],
    variations: [
      { description: "Extra tiles, $5,000", number: 1, status: "PENDING" },
    ],
  };
  const kindsFor = async (principal: ReturnType<typeof adminPrincipal>) => {
    const [attention] = await readProjectAttention(
      principal,
      recordingDb({ "project.findMany": [row] }).db,
    );
    return attention.conditions.map((condition) => condition.kind);
  };
  assert.equal(
    (await kindsFor(siteManagerPrincipal(SM))).includes("VARIATION"),
    false,
  );
  assert.equal((await kindsFor(adminPrincipal())).includes("VARIATION"), true);
});

/* --------------------------------------------- follow-up badges -- */

test("a follow-up badge counts days on Sydney's calendar, not the machine's", () => {
  // Due at Sydney midnight on Fri 20 Nov (13:00 UTC on the 19th). At 01:00 UTC
  // on the 20th it is noon Friday in Sydney: due today, though UTC's calendar
  // says the due date was yesterday.
  const dueAt = new Date("2026-11-19T13:00:00Z");
  assert.equal(
    calculateFollowUpBadgeLabel(dueAt, new Date("2026-11-20T01:00:00Z")),
    "Due today",
  );
  assert.equal(
    calculateFollowUpBadgeLabel(dueAt, new Date("2026-11-20T14:00:00Z")),
    "1 day overdue",
  );
});
