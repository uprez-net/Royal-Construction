import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";

import rootAgent from "@/agent/agent";
import currentTimeInstructions from "@/agent/lib/current-time-instructions";
import orchestratorCurrentTime from "@/agent/instructions/sydney-clock";
import adminCurrentTime from "@/agent/subagents/admin-operations/instructions/sydney-clock";
import complianceCurrentTime from "@/agent/subagents/compliance-operations/instructions/sydney-clock";
import leadCurrentTime from "@/agent/subagents/lead-operations/instructions/sydney-clock";
import offerCurrentTime from "@/agent/subagents/offer-operations/instructions/sydney-clock";
import projectCurrentTime from "@/agent/subagents/project-operations/instructions/sydney-clock";
import tradieCurrentTime from "@/agent/subagents/tradie-operations/instructions/sydney-clock";
import {
  DELEGATE_TARGETS,
  SPECIALISTS,
  type SpecialistName,
} from "@/agent/lib/specialists";
import { searchLeadsInputSchema } from "@/agent/lib/lead-contracts";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import delegate from "@/agent/tools/delegate";
import { REPO_ROOT } from "../support/repo-root";

/**
 * The orchestrator reaches its specialists only through the blocking
 * `delegate` workflow tool. These are the invariants that keep that true — a
 * specialist that quietly regains its own model tool goes back to being a
 * background task, which an MCP invocation reports as "completed" while
 * terminating the specialist mid-work.
 */

const SUBAGENTS_DIR = path.join(REPO_ROOT, "agent", "subagents");

function declaredSpecialists(): string[] {
  return readdirSync(SUBAGENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function hasTools(name: string): boolean {
  const dir = path.join(SUBAGENTS_DIR, name, "tools");
  return (
    existsSync(dir) && readdirSync(dir).some((file) => file.endsWith(".ts"))
  );
}

const savedFlag = process.env.EVE_OPERATIONS_SPECIALISTS_ENABLED;
beforeEach(() => {
  process.env.EVE_OPERATIONS_SPECIALISTS_ENABLED = "true";
});
afterEach(() => {
  if (savedFlag === undefined)
    Reflect.deleteProperty(process.env, "EVE_OPERATIONS_SPECIALISTS_ENABLED");
  else process.env.EVE_OPERATIONS_SPECIALISTS_ENABLED = savedFlag;
});

test("the catalogue lists exactly the specialists declared on disk", () => {
  assert.deepEqual(Object.keys(SPECIALISTS).sort(), declaredSpecialists());
});

test("every specialist takes its definition from the catalogue under its own name", () => {
  for (const name of declaredSpecialists()) {
    const source = readFileSync(
      path.join(SUBAGENTS_DIR, name, "agent.ts"),
      "utf8",
    );
    assert.match(
      source,
      new RegExp(`defineRCSpecialist\\("${name}"\\)`),
      `${name}/agent.ts must call defineRCSpecialist("${name}")`,
    );
  }
});

test("a specialist is hidden from the orchestrator's model tools", async () => {
  for (const name of declaredSpecialists()) {
    const specialist = (await import(`@/agent/subagents/${name}/agent`)) as {
      default: {
        events: Record<
          string,
          (event: unknown, ctx: unknown) => Record<string, unknown> | null
        >;
      };
    };
    const resolved = specialist.default.events["session.started"]?.(
      {},
      { session: { auth: { current: { principalType: "user" } } } },
    );
    assert.ok(resolved, `${name} resolves for a signed-in user`);
    assert.equal(
      resolved.tool,
      false,
      `${name} must set tool: false so it is reached only through delegate`,
    );
  }
});

test("delegate offers exactly the specialists that own tools", () => {
  const withTools = declaredSpecialists().filter(hasTools);
  assert.deepEqual([...DELEGATE_TARGETS].sort(), withTools);
});

test("every specialist registers its session, so its stream can be followed", () => {
  // Child sessions are only readable by their owner, and ownership is the
  // AgentSession row the persist hook writes. Without it the workspace's live
  // progress and the evals' child-stream read are both refused.
  for (const name of declaredSpecialists()) {
    const hook = path.join(SUBAGENTS_DIR, name, "hooks", "persist-events.ts");
    assert.ok(existsSync(hook), `${name} is missing hooks/persist-events.ts`);
    const source = readFileSync(hook, "utf8");
    assert.ok(
      source.includes(
        'import persistAgentEvents from "@/agent/hooks/persist-events";',
      ),
      `${name} imports the shared persist hook`,
    );
    assert.doesNotMatch(
      source,
      /export \{[^}]*\} from/,
      `${name} imports the hook rather than re-exporting it`,
    );
  }
});

type DelegateContext = {
  agents: Record<string, { description: string }>;
  agent: (target: string, input: { message: string }) => Promise<unknown>;
};

const runDelegate = delegate.execute as unknown as (
  input: { specialist: SpecialistName; request: string },
  ctx: DelegateContext,
) => Promise<Record<string, unknown>>;

test("delegate waits for the specialist and returns its envelope, named", async () => {
  const calls: { target: string; message: string }[] = [];
  const envelope = {
    kind: "entity-summary",
    summary: "Stage: quoting.",
    title: "Smith — 12 Example St",
    version: 1,
  };
  const result = await runDelegate(
    { request: "Open the Smith lead.", specialist: "lead-operations" },
    {
      agent: async (target, input) => {
        calls.push({ message: input.message, target });
        return envelope;
      },
      agents: { "lead-operations": { description: "" } },
    },
  );

  assert.deepEqual(calls, [
    { message: "Open the Smith lead.", target: "lead-operations" },
  ]);
  // Returned as the canonical envelope: version stamped, defaults filled.
  assert.deepEqual(result, {
    ...agentResultEnvelopeSchema.parse(envelope),
    specialist: "lead-operations",
  });
});

test("delegate says a disabled specialist is unavailable instead of calling it", async () => {
  let called = false;
  const result = await runDelegate(
    { request: "List the team.", specialist: "admin-operations" },
    {
      agent: async () => {
        called = true;
        return null;
      },
      agents: {},
    },
  );

  assert.equal(called, false);
  assert.equal(result.kind, "error");
  assert.equal(result.specialist, "admin-operations");
  assert.match(String(result.summary), /nothing was looked up or changed/);
});

test("a specialist failure is not swallowed into a success", async () => {
  await assert.rejects(
    runDelegate(
      { request: "Open the Smith lead.", specialist: "lead-operations" },
      {
        agent: async () => {
          throw new Error("SESSION_TOKEN_LIMIT_REACHED");
        },
        agents: { "lead-operations": { description: "" } },
      },
    ),
    /SESSION_TOKEN_LIMIT_REACHED/,
  );
});

test("the MCP-visible agent description names what the agent can and cannot do", () => {
  const description = (rootAgent as { description?: string }).description;
  assert.ok(description && description.length > 200);
  assert.match(description, /input_required/);
  assert.match(description, /agent_update/);
  assert.match(description, /Not available/);
});

test("the orchestrator and every specialist share the current-time instruction object", () => {
  for (const [name, instructions] of [
    ["orchestrator", orchestratorCurrentTime],
    ["admin-operations", adminCurrentTime],
    ["compliance-operations", complianceCurrentTime],
    ["lead-operations", leadCurrentTime],
    ["offer-operations", offerCurrentTime],
    ["project-operations", projectCurrentTime],
    ["tradie-operations", tradieCurrentTime],
  ] as const) {
    assert.strictEqual(
      instructions,
      currentTimeInstructions,
      `${name} uses the shared current-time instruction`,
    );
  }
});

// #432: one write needed two approvals — a model-written "Please approve
// creating this task" card, then the tool's real one — and a stage move ran a
// second specialist just to "verify". The tool's approval card is the only
// approval, and every specialist that writes is told so.
test("every specialist that writes is told the tool's card is the only approval", () => {
  for (const name of Object.keys(SPECIALISTS)) {
    if (!hasTools(name)) continue;
    const source = readFileSync(
      path.join(SUBAGENTS_DIR, name, "instructions.md"),
      "utf8",
    );
    assert.match(source, /## Writing/, `${name} has the write rule`);
    assert.match(source, /Never ask them in prose to\s+approve/, name);
  }
});

test("the orchestrator is told one approval per change and no verify delegation", () => {
  const source = readFileSync(
    path.join(REPO_ROOT, "agent", "instructions.md"),
    "utf8",
  );
  assert.match(source, /One approval per change/);
  assert.match(source, /never\s+send a second delegate call just to "verify"/);
  assert.match(
    (delegate as { description?: string }).description ?? "",
    /Never delegate a separate verify or preview step/,
  );
});

// #432: the same "anything overdue?" gave 11 from the snapshot and a Lost
// lead's wait from a walk through leads.
test("an office-wide overdue question goes to the snapshot or the one overdue tool", () => {
  const source = readFileSync(
    path.join(REPO_ROOT, "agent", "instructions.md"),
    "utf8",
  );
  assert.match(source, /overview questions/);
  assert.match(source, /list_overdue_lead_tasks/);
  assert.ok(
    existsSync(
      path.join(
        SUBAGENTS_DIR,
        "lead-operations",
        "tools",
        "list_overdue_lead_tasks.ts",
      ),
    ),
  );
  const lead = readFileSync(
    path.join(SUBAGENTS_DIR, "lead-operations", "instructions.md"),
    "utf8",
  );
  assert.match(lead, /never `search_leads` followed by `list_lead_tasks`/);
});

// #432: documents filed under another project were folded into "the files for
// 11 Wheat Street" because the search carried no ids and the hits named no job.
test("the orchestrator passes a job's ids to the document search and names other-job hits", () => {
  const source = readFileSync(
    path.join(REPO_ROOT, "agent", "instructions.md"),
    "utf8",
  );
  assert.match(source, /always pass its ids/);
  assert.match(source, /otherJob/);
});

// #434 review: "how many leads in Sydney?" was counted with no query, so
// `totalCount` covered the whole pipeline. Only a request with no text
// criteria leaves `query` empty.
test("a filtered lead count passes its criteria to search_leads", () => {
  const lead = readFileSync(
    path.join(SUBAGENTS_DIR, "lead-operations", "instructions.md"),
    "utf8",
  );
  // Text criteria go in `query`; a stage goes in `stages`, never in `query`.
  assert.match(lead, /`query: "Sydney"`/);
  assert.match(lead, /`stages: \["Converted"\]`/);
  // Every `stages` example must be a call the tool's schema accepts.
  for (const [, list] of lead.matchAll(/`stages: (\[[^\]]*\])`/g)) {
    searchLeadsInputSchema.parse({ stages: JSON.parse(list) });
  }
  // The two counts have different scopes, and unsupported filters are named.
  assert.match(
    lead,
    /`countsByStage` counts the query's matches\s+by\s+stage,\s+ignoring\s+`stages`/,
  );
  assert.match(lead, /cannot\s+filter\s+by\s+assignee\s+or\s+date/);
  assert.doesNotMatch(
    lead,
    /To list or count leads, call `search_leads` with no query/,
  );
});
