import assert from "node:assert/strict";
import { test } from "vitest";

import { describeApprovalTargets } from "@/lib/domain/agent/approval-targets";
import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

const project = {
  id: "project_1",
  location: "Catherine Field",
  name: "Lot 9028 Sommerville Drive TEST",
  siteManagerId: "manager_1",
};

const records = {
  "milestone.findUnique": {
    name: "Cut & Fill - Concretor (Land Leveling)",
    projectId: "project_1",
  },
  "project.findUnique": project,
  "tradie.findUnique": {
    id: "tradie_1",
    name: "Land Surveying Services Pty Ltd",
    trade: "Surveying",
  },
};

test("an approval names its milestone, project and tradie, not just their ids", async () => {
  // The create_schedule approval on staging showed three bare UUIDs.
  const labels = await describeApprovalTargets(
    adminPrincipal(),
    {
      durationDays: 2,
      milestoneId: "milestone_1",
      projectId: "project_1",
      tradieId: "tradie_1",
    },
    recordingDb(records).db,
  );

  assert.deepEqual(labels, {
    milestoneId:
      "Cut & Fill - Concretor (Land Leveling) · Lot 9028 Sommerville Drive TEST",
    projectId: "Lot 9028 Sommerville Drive TEST",
    tradieId: "Land Surveying Services Pty Ltd (Surveying)",
  });
});

test("a record the caller may not manage gets no label", async () => {
  // Same access rule the tool applies: a site manager off this project must
  // not learn its name, or its milestone's, from an approval card.
  const labels = await describeApprovalTargets(
    siteManagerPrincipal("manager_other"),
    { milestoneId: "milestone_1", projectId: "project_1" },
    recordingDb(records).db,
  );

  assert.deepEqual(labels, {});
});

test("a missing record gets no label, and other fields are ignored", async () => {
  const labels = await describeApprovalTargets(
    adminPrincipal(),
    { milestoneId: "milestone_gone", status: "ACTIVE" },
    recordingDb({ "milestone.findUnique": null }).db,
  );

  assert.deepEqual(labels, {});
});

test("an offer is named by its reference, revision and client", async () => {
  const labels = await describeApprovalTargets(
    adminPrincipal(),
    { offerId: "offer_1" },
    recordingDb({
      "lead.findUnique": { assignedId: null, id: 98 },
      "offer.findUnique": {
        baseReference: "RC-Q-2026-020",
        isActive: true,
        lead: { name: "E2E Test 24Aug" },
        leadId: 98,
        revisionNumber: 2,
      },
    }).db,
  );

  assert.deepEqual(labels, { offerId: "RC-Q-2026-020-R2 · E2E Test 24Aug" });
});

test("a database failure is not mistaken for a refusal", async () => {
  await assert.rejects(
    describeApprovalTargets(
      adminPrincipal(),
      { projectId: "project_1" },
      recordingDb({
        "project.findUnique": () => {
          throw new Error("connection reset");
        },
      }).db,
    ),
    /connection reset/,
  );
});

test("a lead is named by client and site, and a task by what and when", async () => {
  // A lead had four open meeting tasks on staging; "Meeting task #67" did not
  // say which one an approval would close. Names, not database numbers.
  const labels = await describeApprovalTargets(
    adminPrincipal(),
    { leadId: 105, taskId: 67 },
    recordingDb({
      "lead.findUnique": {
        assignedId: null,
        id: 105,
        location: "Kellyville NSW",
        name: "Harpreet & Manpreet Sandhu",
      },
      "leadTask.findUnique": {
        dueDate: new Date("2026-09-23T14:00:00Z"),
        dueTime: "10:00",
        lead: { name: "Harpreet & Manpreet Sandhu" },
        leadId: 105,
        notes: "Site measure and design brief at Kellyville",
        type: "MEETING",
      },
    }).db,
  );

  assert.deepEqual(labels, {
    leadId: "Harpreet & Manpreet Sandhu — Kellyville NSW",
    taskId:
      "Meeting task · due Thu 24 Sept 2026 10:00 · Site measure and design brief at Kellyville · Harpreet & Manpreet Sandhu",
  });
  assert.doesNotMatch(JSON.stringify(labels), /#\d|105|67/);
});
