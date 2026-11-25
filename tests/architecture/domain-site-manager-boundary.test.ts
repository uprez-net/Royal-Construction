import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { Role } from "@prisma/client";
import { test } from "vitest";

import { canSeeProjectFinancials } from "@/lib/domain/access/projects";
import { searchAgentContext } from "@/lib/domain/agent-context";
import { listLeadCommsUnread } from "@/lib/domain/comms/unread";
import { listPendingComms } from "@/lib/domain/comms/pending";
import { DomainAuthorizationError } from "@/lib/domain/errors";
import {
  anonymousPrincipal,
  isOfficePrincipal,
  isOfficeRole,
  systemPrincipal,
} from "@/lib/domain/principal";
import {
  hideDetailProjectFinancials,
  hideListProjectFinancials,
  withoutTradieQuotes,
} from "@/lib/domain/projects/financial-redaction";
import {
  listProjectFollowUpsDue,
  listSiteManagerPerformance,
} from "@/lib/domain/projects/site-dashboard";
import type { ProjectDetail, ProjectWithStats } from "@/types/project";

import { REPO_ROOT } from "../support/repo-root";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// A site manager is staff for projects and not for the sales side (leads,
// offers, client calls and texts, the office's figures) or for what a project
// costs. These pin the rule at the places the old one leaked.

/* ------------------------------------------------------------ the rule -- */

test("the office is ADMIN; a site manager, a GUEST and a customer are not in it", () => {
  assert.equal(isOfficeRole(Role.ADMIN), true);
  assert.equal(isOfficeRole(Role.GUEST), false);
  assert.equal(isOfficeRole(Role.SITE_MANAGER), false);
  assert.equal(isOfficeRole(Role.CUSTOMER), false);

  assert.equal(isOfficePrincipal(adminPrincipal()), true);
  assert.equal(isOfficePrincipal(siteManagerPrincipal()), false);
  assert.equal(isOfficePrincipal(customerPrincipal()), false);
  assert.equal(isOfficePrincipal(systemPrincipal("cron:x")), true);
  assert.equal(isOfficePrincipal(anonymousPrincipal("booking")), false);
});

test("client calls, texts and the office context refuse a site manager and write nothing", async () => {
  const principal = siteManagerPrincipal();
  const recorder = recordingDb();

  await assert.rejects(
    listPendingComms(principal, recorder.db),
    DomainAuthorizationError,
  );
  await assert.rejects(
    listLeadCommsUnread(principal, { leadIds: [1] }, recorder.db),
    DomainAuthorizationError,
  );
  await assert.rejects(
    searchAgentContext(principal, { query: "price" }, recorder.db),
    DomainAuthorizationError,
  );
  // Refused before any read, let alone a write.
  assert.deepEqual(recorder.operations(), []);
  assert.deepEqual(recorder.writes(), []);
});

test("the sales-side domain modules never fall back to the broad staff rule", () => {
  // `isInternalPrincipal` / `isInternalRole` include SITE_MANAGER. A lead, a
  // client message or an email asking them would quietly let one in again.
  const roots = [
    "lib/domain/comms",
    "lib/domain/leads",
    "lib/domain/email",
    "lib/domain/offers",
    "lib/domain/agent-context",
  ];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) {
        const source = readFileSync(full, "utf8");
        if (/\bisInternal(Principal|Role)\(/.test(source)) {
          offenders.push(full.replace(`${REPO_ROOT}/`, ""));
        }
      }
    }
  };
  for (const root of roots) walk(join(REPO_ROOT, root));
  assert.deepEqual(offenders, []);
});

/* ------------------------------------------------------ project money -- */

test("only an admin or the system may see what a project costs", () => {
  assert.equal(canSeeProjectFinancials(adminPrincipal()), true);
  assert.equal(canSeeProjectFinancials(systemPrincipal("cron:x")), true);
  assert.equal(canSeeProjectFinancials(siteManagerPrincipal()), false);
  assert.equal(canSeeProjectFinancials(customerPrincipal()), false);
  assert.equal(canSeeProjectFinancials(anonymousPrincipal("booking")), false);
});

const COMMERCIALS = {
  claimStageSlabDollarValue: 9,
  claimStageSlabPercentage: 10,
  depositValue: 5000,
  gstAmount: 8000,
  gstIncluded: true,
  latePenaltyRate: 1,
  paymentStages: [{ name: "Slab", amount: 1 }],
  totalContractSum: 880000,
  variationAdminFee: 3,
};

const MONEY_MARKERS = ["123456", "777.77", "654321", "88000", "880000"];

function assertNoMoney(payload: unknown) {
  const json = JSON.stringify(payload);
  for (const marker of MONEY_MARKERS) {
    assert.equal(json.includes(marker), false, `${marker} survived`);
  }
}

test("a hidden list row carries no budget, spend, claim or contract sum", () => {
  const row = {
    approvedVariationSpend: "123456",
    invoiceTotals: {
      invoiced: "654321",
      outstanding: "88000",
      paid: "1",
      pendingCount: 2,
    },
    invoices: [{ id: "i1", total: "654321" }],
    name: "12 Rose St",
    requirements: {
      commercialsAndClaims: COMMERCIALS,
      safetyAndSiteLogistics: { kept: true },
    },
    spent: "777.77",
    totalBudget: "123456",
  } as unknown as ProjectWithStats;

  const hidden = hideListProjectFinancials(row);

  assertNoMoney(hidden);
  assert.equal(hidden.financialsHidden, true);
  assert.equal(hidden.name, "12 Rose St");
  // What the site manager builds from stays.
  assert.deepEqual(
    (hidden.requirements as unknown as Record<string, unknown>)
      .safetyAndSiteLogistics,
    { kept: true },
  );
});

test("a hidden detail carries no money anywhere in its tree", () => {
  const milestone = {
    budget: "123456",
    id: "m1",
    name: "Slab",
    spend: "777.77",
    tradieInvoicedOverride: "654321",
    tradieQuotedOverride: "88000",
  };
  const detail = {
    activityLogs: [
      { id: "a1", message: "Built", type: "milestoneStatusChanged" },
      {
        id: "a2",
        message: "quoted price changed from 123456 to 654321",
        type: "milestonePriceChanged",
      },
      {
        id: "a3",
        message: "Tradie quoted a price of 88000",
        type: "tradieScheduleQuoted",
      },
      {
        id: "a4",
        message: "Variation status updated with description: tiles, $5,000",
        type: "variationUpdated",
      },
    ],
    customer: { email: "client@example.com", id: "c1", phone: "0412 000 000" },
    documents: [
      { fileId: "f_photo", key: "f_photo", source: "milestone" },
      { fileId: "f_hbcf", key: "f_hbcf", source: "project" },
      { fileId: "f_da", key: "f_da", source: "compliance" },
      { fileId: null, key: "invoice:1", source: "tradie-invoice" },
      { fileId: "f_var", key: "f_var", source: "variation" },
      { fileId: "f_lead", key: "f_lead", source: "lead" },
    ],
    files: [
      { complianceDocumentId: null, id: "f_photo", leadId: null },
      { complianceDocumentId: null, id: "f_hbcf", leadId: null },
    ],
    lead: { emails: [{ body: "Your quotation is 880000" }], id: 4 },
    leadId: 4,
    invoices: [{ total: "654321" }],
    materials: [{ id: "x", totalCost: "123456", unitCost: "777.77" }],
    milestones: [milestone],
    name: "12 Rose St",
    requirements: {
      commercialsAndClaims: COMMERCIALS,
      legalAdministration: {
        hbcfInsuranceDocument: { fileId: "f_hbcf", url: "u" },
        hbcfInsuranceNumber: "HB-1",
        siteAddress: "12 Rose St",
      },
    },
    siteUpdates: [{ id: "s1", milestone }],
    spent: "777.77",
    totalBudget: "123456",
    tradieSchedules: [
      {
        billing: "PART_INVOICED",
        id: "t1",
        milestone,
        quotedPrice: "88000",
        tradie: { lastQuotedPrice: "654321", name: "Raj" },
      },
    ],
    variations: [{ cost: "123456", newPrice: "654321" }],
  } as unknown as ProjectDetail;

  const hidden = hideDetailProjectFinancials(detail);

  assertNoMoney(hidden);
  assert.equal(hidden.financialsHidden, true);
  assert.equal(hidden.milestones[0]?.name, "Slab");
  assert.equal(hidden.tradieSchedules[0]?.tradie.name, "Raj");
  assert.deepEqual(hidden.variations, []);
  // The History tab is the office's (canSeeProjectHistory): none of it.
  assert.deepEqual(hidden.activityLogs, []);
  // HBCF goes whole (number, certificate, its file); the office's documents
  // (compliance file, lead, tradie invoices, variations) go too.
  const legal = hidden.requirements?.legalAdministration as unknown as Record<
    string,
    unknown
  >;
  assert.equal("hbcfInsuranceNumber" in legal, false);
  assert.equal("hbcfInsuranceDocument" in legal, false);
  assert.equal(legal.siteAddress, "12 Rose St");
  assert.deepEqual(
    hidden.documents.map((document) => document.key),
    ["f_photo"],
  );
  assert.deepEqual(
    hidden.files.map((file) => file.id),
    ["f_photo"],
  );
  // The sales record is gone, not just its thread; the client's contact
  // details stay on `customer` (#570).
  assert.equal(hidden.lead, null);
  assert.equal(hidden.leadId, null);
  assert.equal(hidden.customer.phone, "0412 000 000");
  assert.equal(hidden.customer.email, "client@example.com");
});

test("tradie quotes come out of a booking payload wherever they sit, and dates stay dates", () => {
  const when = new Date("2026-11-20T00:00:00Z");
  const payload = {
    rows: [
      {
        scheduledDate: when,
        tradie: { lastQuotedPrice: "500", name: "Raj" },
        quotedPrice: "1200",
      },
    ],
  };
  const clean = withoutTradieQuotes(payload);
  assert.equal(JSON.stringify(clean).includes("500"), false);
  assert.equal(JSON.stringify(clean).includes("1200"), false);
  assert.equal(clean.rows[0]?.scheduledDate, when);
  assert.equal(clean.rows[0]?.tradie.name, "Raj");
});

/* ---------------------------------------------------- the dashboard -- */

test("site manager performance is computed from building projects, not a sample list", async () => {
  const recorder = recordingDb({
    "user.findMany": [
      {
        id: "sm1",
        name: "Sunny",
        siteManagerProjects: [
          {
            milestones: [
              { status: "DONE" },
              { status: "NOT_REQUIRED" },
              { status: "ACTIVE" },
              { status: "PENDING" },
            ],
          },
          { milestones: [{ status: "DONE" }] },
        ],
      },
      { id: "sm2", name: "New starter", siteManagerProjects: [] },
    ],
  });

  const rows = await listSiteManagerPerformance(
    siteManagerPrincipal(),
    recorder.db,
  );

  assert.deepEqual(rows, [
    {
      id: "sm1",
      milestonesCompleted: 3,
      milestonesTotal: 5,
      name: "Sunny",
      projectsCount: 2,
    },
    {
      id: "sm2",
      milestonesCompleted: 0,
      milestonesTotal: 0,
      name: "New starter",
      projectsCount: 0,
    },
  ]);
  assert.deepEqual(recorder.writes(), []);
  await assert.rejects(
    listSiteManagerPerformance(customerPrincipal(), recordingDb().db),
    DomainAuthorizationError,
  );
});

test("project follow-ups are activities under way due by the end of Sydney's today, on building projects", async () => {
  const recorder = recordingDb({ "milestone.findMany": [] });
  // 23:30 UTC on the 19th is 10:30 on the 20th in Sydney (AEDT).
  await listProjectFollowUpsDue(
    siteManagerPrincipal(),
    { now: new Date("2026-11-19T23:30:00Z") },
    recorder.db,
  );

  const call = recorder.calls.find((c) => c.operation === "milestone.findMany");
  const where = (call?.args as { where: Record<string, unknown> }).where;
  assert.equal(where.parentId, null);
  // Under way only: an activity nobody has started is never overdue.
  assert.equal(where.status, "ACTIVE");
  // End of the 20th in Sydney is 12:59:59.999 UTC on the 20th (UTC+11). Only
  // a narrowing: nothing that has not started by tonight can be due.
  const endOfToday = new Date("2026-11-20T12:59:59.999Z");
  assert.deepEqual(where.OR, [
    { startDate: { lte: endOfToday } },
    { startDate: null, targetDate: { lte: endOfToday } },
  ]);
  const project = where.project as { status: { in: string[] } };
  assert.deepEqual(project.status.in, [
    "ACTIVE",
    "ON_TRACK",
    "NEEDS_ATTENTION",
    "DELAYED",
  ]);
  // Nothing here reads a lead.
  assert.equal(
    recorder.operations().some((operation) => operation.startsWith("lead")),
    false,
  );
});

test("a follow-up is due on the activity's estimated completion, the same day the overdue count uses", async () => {
  // Sydney midnight on a given day, as the database stores a date (UTC+11).
  const day = (d: number) => new Date(Date.UTC(2026, 10, d - 1, 13));
  const row = (
    id: string,
    timing: { startDate: Date | null; targetDate: Date; estimatedDays: number },
  ) => ({
    ...timing,
    id,
    name: id,
    project: {
      customer: { name: "Smith" },
      location: "",
      name: "Smith residence",
    },
    projectStage: null,
  });
  const recorder = recordingDb({
    "milestone.findMany": [
      // Started on the 19th, ten days' work: due on the 29th, not today.
      row("underway", {
        estimatedDays: 10,
        startDate: day(19),
        targetDate: day(19),
      }),
      // Planned for the 18th, two days, no start recorded: due to finish today.
      row("today", { estimatedDays: 2, startDate: null, targetDate: day(18) }),
      // Planned for the 10th, two days: overdue since the 13th.
      row("overdue", {
        estimatedDays: 2,
        startDate: null,
        targetDate: day(10),
      }),
    ],
  });

  const due = await listProjectFollowUpsDue(
    siteManagerPrincipal(),
    { now: new Date("2026-11-19T23:30:00Z") }, // 10:30 on the 20th in Sydney
    recorder.db,
  );

  assert.deepEqual(
    due.map((item) => [item.id, item.dueAt.toISOString()]),
    // Most overdue first, whatever order the rows were read in.
    [
      ["overdue", day(12).toISOString()],
      ["today", day(20).toISOString()],
    ],
  );
});
