import assert from "node:assert/strict";

import { MilestoneStatus, ProjectStatus, Role } from "@prisma/client";
import { test } from "vitest";

import { DomainAuthorizationError } from "@/lib/domain/errors";
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
  withStoredHbcfClaimAmounts,
} from "@/lib/domain/projects/financial-redaction";
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
    legalAdministration: { hbcfClaimDocuments: [CONFIRMED] },
  } as unknown as ProjectRequirementsPayload);
  assert.deepEqual(hidden?.legalAdministration.hbcfClaimDocuments, [
    { ...CONFIRMED, claimAmount: null },
  ]);
});

test("a blanked HBCF amount saved back keeps the stored one; a new document arrives unconfirmed", () => {
  const restored = withStoredHbcfClaimAmounts(
    {
      hbcfClaimDocuments: [
        { ...CONFIRMED, claimAmount: null },
        { ...CONFIRMED, amountConfirmed: true, claimAmount: 9, fileId: "f_2" },
      ],
    },
    { hbcfClaimDocuments: [CONFIRMED] },
  );
  assert.deepEqual(restored.hbcfClaimDocuments, [
    CONFIRMED,
    { ...CONFIRMED, amountConfirmed: false, claimAmount: 9, fileId: "f_2" },
  ]);
});

test("a site manager's project save cannot change a confirmed HBCF amount", async () => {
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
      requirements: {
        legalAdministration: { hbcfClaimDocuments: [CONFIRMED] },
      },
      startDate: new Date("2026-06-01T00:00:00.000Z"),
      status: ProjectStatus.ON_TRACK,
    },
  });

  await updateProject(
    siteManagerPrincipal(SM),
    {
      projectId: "p_1",
      requirements: {
        legalAdministration: {
          hbcfClaimDocuments: [{ ...CONFIRMED, claimAmount: 0 }],
        },
      },
    },
    recorder.db,
  );

  const write = recorder
    .writes()
    .find((call) => call.operation === "project.update")?.args as {
    data: { requirements: { legalAdministration: Record<string, unknown> } };
  };
  assert.deepEqual(
    write.data.requirements.legalAdministration.hbcfClaimDocuments,
    [CONFIRMED],
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
