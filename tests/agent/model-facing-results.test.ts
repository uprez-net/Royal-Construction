import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

import { findCancelledApproval } from "@/agent/lib/cancelled-approval";
import {
  forModel,
  forModelKeeping,
  forPeopleDates,
} from "@/agent/lib/model-output";
import {
  agentResultEnvelopeSchema,
  normalizeSpecialistResult,
  type AgentResultEnvelope,
} from "@/agent/lib/result-contracts";
import { CANCELLED_TITLE, specialistFinding } from "@/agent/lib/team-dispatch";
import { REPO_ROOT } from "../support/repo-root";

type Finding = AgentResultEnvelope & { specialist: string };

// #429, found driving the staging workspace on 13 Nov 2026.

// --- Dates ----------------------------------------------------------------

test("a task stored at Sydney midnight reads as its Sydney date, not the UTC day before", () => {
  // Fri 25 Sept 2026 00:00 AEST is 14:00 UTC on Thursday the 24th.
  const output = forModel({
    data: { tasks: [{ id: 67, dueAt: "2026-09-24T14:00:00.000Z" }] },
  });
  assert.deepEqual(output, {
    type: "json",
    value: { data: { tasks: [{ id: 67, dueAt: "Fri 25 Sept 2026" }] } },
  });
});

test("a timestamp with a time keeps it, on the Sydney clock", () => {
  assert.equal(
    forPeopleDates("2026-09-24T23:00:00.000Z", "scheduledAt"),
    "Fri 25 Sept 2026, 9:00 am AEST",
  );
});

test("dates inside prose are rewritten; ids, links and concurrency tokens are not", () => {
  const value = forPeopleDates({
    summary: "Site measure due 2026-09-24T14:00:00.000Z.",
    leadId: "2026-09-24",
    href: "/leads/105?from=2026-09-24",
    updatedAt: "2026-11-12T03:15:00.000Z",
    file: "quote-2026-09-25.pdf",
  }) as Record<string, string>;
  assert.equal(value.summary, "Site measure due Fri 25 Sept 2026.");
  assert.equal(value.leadId, "2026-09-24");
  assert.equal(value.href, "/leads/105?from=2026-09-24");
  assert.equal(value.updatedAt, "2026-11-12T03:15:00.000Z");
  assert.equal(value.file, "quote-2026-09-25.pdf");
});

test("file names and email addresses are kept exact", () => {
  const value = forPeopleDates({
    file: "2026-09-24.pdf",
    fileName: "2026-09-24.pdf",
    email: "site-2026-09-24@example.com",
    contactEmail: "2026-09-24@example.com",
  }) as Record<string, string>;
  assert.equal(value.file, "2026-09-24.pdf");
  assert.equal(value.fileName, "2026-09-24.pdf");
  assert.equal(value.email, "site-2026-09-24@example.com");
  assert.equal(value.contactEmail, "2026-09-24@example.com");
});

test("offer draft text the model may write back stays as stored", () => {
  const output = forModelKeeping("draft")({
    data: {
      offer: { sentAt: "2026-09-24T14:00:00.000Z" },
      workspace: {
        draft: {
          introText: "Prices held until 2026-09-24.",
          exclusionBullets: ["Rock removal after 2026-09-24"],
        },
      },
    },
  }) as {
    value: {
      data: { offer: { sentAt: string }; workspace: { draft: unknown } };
    };
  };
  assert.equal(output.value.data.offer.sentAt, "Fri 25 Sept 2026");
  assert.deepEqual(output.value.data.workspace.draft, {
    introText: "Prices held until 2026-09-24.",
    exclusionBullets: ["Rock removal after 2026-09-24"],
  });
});

/**
 * Tools whose output the model edits and writes back whole, so a humanised
 * date would be stored as the new value.
 */
const RAW_FOR_ROUND_TRIP = new Set([
  "project-operations/tools/get_project_requirements.ts",
]);

test("every specialist tool shows the model Sydney dates", () => {
  const root = path.join(REPO_ROOT, "agent/subagents");
  const missing: string[] = [];
  for (const specialist of readdirSync(root)) {
    const tools = path.join(root, specialist, "tools");
    if (!existsSync(tools)) continue;
    for (const file of readdirSync(tools).filter((name) =>
      name.endsWith(".ts"),
    )) {
      const name = `${specialist}/tools/${file}`;
      if (RAW_FOR_ROUND_TRIP.has(name)) continue;
      const source = readFileSync(path.join(tools, file), "utf8");
      if (!/toModelOutput: forModel(?:Keeping\([^)]*\))?,/.test(source)) {
        missing.push(name);
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    "A specialist tool without `toModelOutput: forModel` hands the model raw UTC timestamps.",
  );
});

// --- The specialist's final answer ---------------------------------------

test("a long or loosely shaped answer is kept, shortened, rather than refused", () => {
  const result = normalizeSpecialistResult({
    kind: "project-overview",
    title: "Lot 9028 Sommerville Drive",
    summary: "x".repeat(2_400),
    milestones: [{ name: "Cut & Fill", status: "ACTIVE" }],
    warnings: ["y".repeat(700)],
    links: [
      { label: "Project", href: "/projects/abc" },
      { label: "Elsewhere", href: "https://example.com" },
    ],
    entityRef: {
      type: "project",
      id: 42,
      display: { label: "Lot 9028", extra: "ignored" },
    },
  });

  assert.ok(agentResultEnvelopeSchema.safeParse(result).success);
  assert.equal(result.kind, "entity-summary");
  assert.equal(result.summary.length, 2_000);
  assert.equal(result.warnings[0]!.length, 500);
  assert.deepEqual(result.links, [{ label: "Project", href: "/projects/abc" }]);
  assert.deepEqual(result.data.milestones, [
    { name: "Cut & Fill", status: "ACTIVE" },
  ]);
  assert.equal(result.entityRef?.id, "42");
});

test("a specialist's ISO date never reaches the orchestrator", () => {
  const finding = specialistFinding("lead-operations", {
    kind: "task-list",
    title: "Sandhu meetings",
    summary: "Site measure and design brief on 2026-09-24T14:00:00.000Z.",
    data: { dueAt: "2026-09-24T14:00:00.000Z" },
  }) as Finding;
  assert.equal(
    finding.summary,
    "Site measure and design brief on Fri 25 Sept 2026.",
  );
  assert.equal(finding.data.dueAt, "Fri 25 Sept 2026");
  assert.equal(finding.specialist, "lead-operations");
});

// --- A cancelled approval ------------------------------------------------

const deniedResult = {
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "update_lead",
      output: {
        type: "error-json",
        value: {
          code: "TOOL_EXECUTION_DENIED",
          message: "Tool execution was denied.",
          approval: { status: "denied" },
        },
      },
    },
  ],
};

test("a cancelled approval since the request is found, and names the tool", () => {
  assert.equal(
    findCancelledApproval([
      { role: "user", content: [{ type: "text", text: "Move to Qualified" }] },
      { role: "assistant", content: [{ type: "tool-call" }] },
      deniedResult,
    ]),
    "update_lead",
  );
});

test("a request with no cancelled approval is left alone", () => {
  assert.equal(
    findCancelledApproval([
      { role: "user", content: [{ type: "text", text: "Read the lead" }] },
      {
        role: "tool",
        content: [{ type: "tool-result", toolName: "get_lead", output: {} }],
      },
    ]),
    null,
  );
  // A denial before the latest request belongs to an earlier task.
  assert.equal(
    findCancelledApproval([deniedResult, { role: "user", content: [] }]),
    null,
  );
});

test("a cancelled change reads as the person's decision, in fixed words", () => {
  const finding = specialistFinding("lead-operations", {
    kind: "error",
    title: "Stage change was denied",
    summary:
      "The stage change was denied by the system: manual moves aren't allowed while an offer drives the stage.",
    warnings: ["Offer-controlled stages cannot be set manually."],
    data: {
      cancelled: true,
      change: "Move the Wilton Uppal lead to Qualified",
    },
  }) as Finding;
  assert.equal(finding.kind, "confirmation");
  assert.equal(finding.title, CANCELLED_TITLE);
  assert.equal(
    finding.summary,
    "You cancelled this change (Move the Wilton Uppal lead to Qualified), so it was not applied.",
  );
  // The invented rule rode in the warnings on staging.
  assert.deepEqual(finding.warnings, []);
});

test("a denial is read from the result's structure, as eve writes it", () => {
  const request = {
    role: "user",
    content: [{ type: "text", text: "Move to Qualified" }],
  };
  // How eve records a denial in the transcript the hook reads.
  assert.equal(
    findCancelledApproval([
      request,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "update_lead",
            output: {
              type: "execution-denied",
              reason: "Tool execution was denied.",
            },
          },
        ],
      },
    ]),
    "update_lead",
  );
  // A successful lookup whose data merely mentions the code is not one.
  assert.equal(
    findCancelledApproval([
      request,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "get_lead",
            output: {
              type: "json",
              value: { note: "Audit: TOOL_EXECUTION_DENIED on 12 Nov" },
            },
          },
        ],
      },
    ]),
    null,
  );
});

test("a date-heavy title still fits the envelope once it is readable", () => {
  // 200 characters as written; longer once each date is spelled out.
  const title = Array.from({ length: 18 }, () => "2026-09-24").join(" ");
  const finding = specialistFinding("lead-operations", {
    kind: "task-list",
    title,
    summary: "Meetings.",
  });
  assert.ok(agentResultEnvelopeSchema.safeParse(finding).success);
  assert.ok(finding.title.length <= 200);
  assert.ok(finding.title.startsWith("Thu 24 Sept 2026"));
});
