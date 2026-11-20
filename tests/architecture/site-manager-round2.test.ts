import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import {
  canBookTradies,
  canRecordOnProject,
  canSeeProjectHistory,
  canSetUpProjectWhatsAppGroup,
} from "@/lib/domain/access/projects";
import { DomainAuthorizationError } from "@/lib/domain/errors";
import { MilestoneStatus as S } from "@prisma/client";

import {
  hideDetailProjectFinancials,
  withStoredHbcf,
} from "@/lib/domain/projects/financial-redaction";
import { updateMilestone } from "@/lib/domain/projects/milestones";
import { assessProjectAttention } from "@/lib/domain/projects/attention";
import { draftProjectWhatsAppInvite } from "@/lib/domain/projects/whatsapp/invite";
import {
  linkProjectWhatsAppGroup,
  listLinkableWhatsAppGroups,
  requestProjectWhatsAppGroup,
} from "@/lib/domain/projects/whatsapp/groups";
import { dismissTradieScheduleAlerts } from "@/lib/domain/tradies/alerts";
import { sendTradieScheduleReminder } from "@/lib/domain/tradies/reminders";
import { sendTradieRequests } from "@/lib/domain/tradies/requests";
import {
  createTradieSchedule,
  createTradieSchedules,
} from "@/lib/domain/tradies/schedules";
import { recordManualQuote } from "@/lib/domain/tradies/trade-selection";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";
import { REPO_ROOT } from "../support/repo-root";

// Owner decisions, 2026-11-20, for a site manager ("just for recording"):
// record site work on every project; no compliance file, History, HBCF,
// bookings, or WhatsApp group set-up.

const SM = "user_sm";
const someoneElsesProject = { id: "p_1", siteManagerId: "user_other_sm" };

test("a site manager records on every project, not only the assigned one", () => {
  assert.equal(
    canRecordOnProject(siteManagerPrincipal(SM), someoneElsesProject),
    true,
  );
  assert.equal(
    canRecordOnProject(siteManagerPrincipal(SM), {
      id: "p_1",
      siteManagerId: null,
    }),
    true,
  );
  assert.equal(canRecordOnProject(adminPrincipal(), someoneElsesProject), true);
  assert.equal(
    canRecordOnProject(customerPrincipal(), someoneElsesProject),
    false,
  );
});

test("bookings, WhatsApp set-up and History are the office's", () => {
  for (const rule of [
    canBookTradies,
    canSetUpProjectWhatsAppGroup,
    canSeeProjectHistory,
  ]) {
    assert.equal(rule(siteManagerPrincipal(SM)), false, rule.name);
    assert.equal(rule(customerPrincipal()), false, rule.name);
    assert.equal(rule(adminPrincipal()), true, rule.name);
  }
});

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

/** The body of one exported function, up to the next top-level declaration. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = source.slice(start + 1).search(/\n(export )?(async )?function /);
  return next === -1
    ? source.slice(start)
    : source.slice(start, start + 1 + next);
}

test("the recording commands use the record rule, the planning ones do not", () => {
  const recording: Record<string, string[]> = {
    "lib/domain/projects/checklists.ts": [
      "listProjectChecklists",
      "getChecklistDetail",
    ],
    "lib/domain/projects/checklist-review.ts": [
      "setChecklistItemState",
      "updateChecklistDetails",
      "attachChecklistPhotos",
      "removeChecklistPhoto",
    ],
    "lib/domain/projects/checklist-issues.ts": ["raiseChecklistIssue"],
    "lib/domain/projects/checklist-issue-email.ts": ["sendChecklistIssueEmail"],
    "lib/domain/projects/checklist-issue-lifecycle.ts": [
      "changeChecklistIssueStatus",
      "verifyChecklistIssue",
      "assignChecklistIssue",
      "commentOnChecklistIssue",
    ],
    "lib/domain/projects/checklist-closure.ts": [
      "closeChecklist",
      "reopenChecklist",
    ],
    "lib/domain/projects/checklist-export.ts": ["exportChecklistDocument"],
    "lib/domain/projects/milestones.ts": [
      "updateMilestone",
      "attachMilestonePhotos",
      "listProjectMilestones",
    ],
    "lib/domain/projects/milestone-notes.ts": [
      "addMilestoneNote",
      "deleteMilestoneNote",
    ],
    "lib/domain/projects/whatsapp/queries.ts": [
      "getProjectWhatsAppThread",
      "markProjectWhatsAppRead",
    ],
    "lib/domain/projects/whatsapp/send.ts": [
      "sendProjectWhatsAppMessage",
      "reconcileProjectWhatsAppMessage",
    ],
  };
  for (const [path, names] of Object.entries(recording)) {
    const source = read(path);
    for (const name of names) {
      assert.match(
        functionBody(source, name),
        /authorize(Project|Milestone)Recording\(/,
        `${path} ${name}`,
      );
    }
  }
  // Planning an activity stays with the office or the assigned site manager.
  assert.match(
    functionBody(read("lib/domain/projects/milestones.ts"), "createMilestone"),
    /authorizeProject\(/,
  );
});

/** Calls refused before any database read: the recorder answers no reads. */
async function refusedBeforeReading(
  label: string,
  call: (db: ReturnType<typeof recordingDb>["db"]) => Promise<unknown>,
) {
  const recorder = recordingDb();
  await assert.rejects(call(recorder.db), DomainAuthorizationError, label);
  assert.deepEqual(recorder.calls, [], label);
}

test("a site manager cannot book, quote, remind or dismiss a booking alert", async () => {
  const sm = siteManagerPrincipal(SM);
  const noop = async () => {};
  await refusedBeforeReading("createTradieSchedule", (db) =>
    createTradieSchedule(sm, {} as never, db),
  );
  await refusedBeforeReading("createTradieSchedules", (db) =>
    createTradieSchedules(sm, [{}] as never, db),
  );
  await refusedBeforeReading("sendTradieRequests", (db) =>
    sendTradieRequests(sm, {} as never, db as never, {} as never),
  );
  await refusedBeforeReading("recordManualQuote", (db) =>
    recordManualQuote(sm, { lines: [{}] } as never, db),
  );
  await refusedBeforeReading("sendTradieScheduleReminder", (db) =>
    sendTradieScheduleReminder(sm, {} as never, db, noop),
  );
  await refusedBeforeReading("dismissTradieScheduleAlerts", (db) =>
    dismissTradieScheduleAlerts(sm, {} as never, db),
  );
});

test("the booking writes the screens and Eve reach all check the booking rule", () => {
  const guarded: Record<string, string[]> = {
    "lib/domain/tradies/schedules.ts": [
      "createTradieSchedule",
      "createTradieSchedules",
      "transitionTradieSchedule",
      "rescheduleTradieSchedule",
      "requestTradieScheduleDeletion",
    ],
    "lib/domain/tradies/requests.ts": [
      "sendTradieRequests",
      "deliverTradieRequest",
      "draftTradieRequestWorkDetails",
    ],
    "lib/domain/tradies/trade-selection.ts": [
      "recordManualQuote",
      "selectTradeQuote",
      "requestTradeCancellation",
    ],
  };
  for (const [path, names] of Object.entries(guarded)) {
    const source = read(path);
    for (const name of names) {
      assert.match(
        functionBody(source, name),
        /assertCanBookTradies\(principal\)/,
        `${path} ${name}`,
      );
    }
  }
});

test("a site manager posts in the WhatsApp group but does not set one up", async () => {
  const sm = siteManagerPrincipal(SM);
  const context = { channel: null, groups: null };
  await refusedBeforeReading("requestProjectWhatsAppGroup", (db) =>
    requestProjectWhatsAppGroup(sm, { projectId: "p_1" }, db, context),
  );
  await refusedBeforeReading("listLinkableWhatsAppGroups", (db) =>
    listLinkableWhatsAppGroups(sm, { projectId: "p_1" }, db, context),
  );
  await refusedBeforeReading("linkProjectWhatsAppGroup", (db) =>
    linkProjectWhatsAppGroup(
      sm,
      { projectId: "p_1", providerGroupId: "g" },
      db as never,
      context,
    ),
  );
  await refusedBeforeReading("draftProjectWhatsAppInvite", (db) =>
    draftProjectWhatsAppInvite(sm, { projectId: "p_1" }, db),
  );
});

test("a site manager's save, handed no HBCF at all, keeps every stored HBCF field", () => {
  const stored = {
    hbcfClaimDocuments: [{ fileId: "f_2", claimAmount: 1000 }],
    hbcfInsuranceDocument: { fileId: "f_1", url: "u" },
    hbcfInsuranceNumber: "HB-1",
    siteAddress: "old",
  };
  // What a site manager's Overview sends back now: no HBCF keys.
  const saved = withStoredHbcf(
    { insuranceClaimStartDate: "2026-12-01", siteAddress: "new" },
    stored,
  ) as Record<string, unknown>;
  assert.deepEqual(saved.hbcfClaimDocuments, stored.hbcfClaimDocuments);
  assert.deepEqual(saved.hbcfInsuranceDocument, stored.hbcfInsuranceDocument);
  assert.equal(saved.hbcfInsuranceNumber, "HB-1");
  assert.equal(saved.siteAddress, "new");
  assert.equal(saved.insuranceClaimStartDate, "2026-12-01");
});

/* ----------------------------- activities on a project they do not manage */

function activityDb(stored: {
  targetDate: Date | null;
  startDate: Date | null;
  status?: S;
}) {
  const activity = {
    id: "activity",
    parentId: null,
    projectId: "project",
    status: S.ACTIVE,
    actualDate: null,
    budget: "0",
    spend: null,
    childrenMilestones: [],
    ...stored,
  };
  return recordingDb({
    // Assigned to someone else: the caller records here, does not manage it.
    "project.findUnique": { id: "project", siteManagerId: "user_other_sm" },
    "project.update": { spent: "0", siteManagerId: "user_other_sm" },
    "milestone.findUnique": { projectId: "project", parentId: null },
    "milestone.findUniqueOrThrow": activity,
    "milestone.update": { ...activity, status: S.DONE },
    "milestone.updateMany": { count: 0 },
    "milestone.count": 1,
    "milestone.aggregate": { _sum: { spend: null } },
    "milestone.findMany": [],
    "tradieSchedule.findMany": [],
  });
}

const TARGET = new Date("2026-11-10T00:00:00.000Z");
const START = new Date("2026-11-01T00:00:00.000Z");

test("any site manager finishes an activity, sending back the dates it was opened with", async () => {
  const recorder = activityDb({ targetDate: TARGET, startDate: START });
  await updateMilestone(
    siteManagerPrincipal(SM),
    {
      milestoneId: "activity",
      status: S.DONE,
      targetDate: "2026-11-10",
      startDate: START.toISOString(),
      actualDate: "2026-11-05",
    },
    recorder.db,
  );
  assert.ok(
    recorder.writes().some((call) => call.operation === "milestone.update"),
  );
});

test("but does not re-plan it or waive it", async () => {
  const sm = siteManagerPrincipal(SM);
  for (const [label, input] of [
    [
      "a new target date",
      {
        status: S.ACTIVE,
        startDate: START.toISOString(),
        targetDate: "2027-01-20",
      },
    ],
    ["a new planned start", { status: S.ACTIVE, startDate: "2026-10-20" }],
    ["not required", { status: S.NOT_REQUIRED, fromPending: true }],
  ] as const) {
    const { fromPending, ...update } = { fromPending: false, ...input };
    const recorder = activityDb({
      targetDate: TARGET,
      startDate: START,
      ...(fromPending ? { status: S.PENDING } : {}),
    });
    await assert.rejects(
      updateMilestone(sm, { milestoneId: "activity", ...update }, recorder.db),
      DomainAuthorizationError,
      label,
    );
    assert.deepEqual(recorder.writes(), [], label);
  }
});

/* ------------------------------------------- the compliance file and gaps */

test("a site manager's detail carries no compliance file and no office files", () => {
  const hidden = hideDetailProjectFinancials({
    activityLogs: [],
    certifierEngagement: { documents: [{ id: "cd_1" }] },
    customer: {},
    documents: [],
    files: [
      { complianceDocumentId: null, id: "f_photo", leadId: null },
      { complianceDocumentId: "cd_1", id: "f_da", leadId: null },
      { complianceDocumentId: null, id: "f_lead", leadId: 7 },
    ],
    invoices: [],
    materials: [],
    milestones: [],
    requirements: { legalAdministration: {} },
    siteUpdates: [],
    tradieSchedules: [],
    variations: [],
  } as never);
  assert.equal(hidden.certifierEngagement, null);
  assert.deepEqual(
    hidden.files.map((file) => file.id),
    ["f_photo"],
  );
});

test("the projects list does not tell a site manager about HBCF or the certificate", () => {
  // Work has started and nothing is on file: the office is told about the
  // HBCF number, the certificate and the Construction Certificate.
  const source = {
    id: "p_1",
    name: "Job",
    location: "1 Example St",
    status: "ACTIVE",
    requirements: {
      legalAdministration: { signedDate: "2026-10-01", pcaInspector: "Jo" },
    },
    customer: { name: "Sam" },
    milestones: [
      {
        id: "m_1",
        name: "Slab",
        status: "ACTIVE",
        targetDate: new Date("2026-12-30T13:00:00Z"),
        startDate: new Date("2026-11-01T13:00:00Z"),
        estimatedDays: 2,
        requiredTradeTypes: [],
      },
    ],
    tradieSchedules: [],
    variations: [],
    checklists: [],
    certifierEngagement: { alerts: [], documents: [] },
  } as never;
  const now = new Date("2026-11-20T00:00:00Z");
  const missing = (seesMoney: boolean) =>
    assessProjectAttention(source, now, seesMoney).conditions.find(
      (c) => c.kind === "MISSING_DOCUMENT",
    )?.details ?? [];
  assert.ok(missing(true).length > 0);
  assert.ok(
    missing(false).every(
      (detail) => !/HBCF|Construction Certificate/i.test(String(detail)),
    ),
  );
});
