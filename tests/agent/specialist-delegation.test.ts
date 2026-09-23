import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";

import rootAgent from "@/agent/agent";
import {
  DELEGATE_TARGETS,
  SPECIALISTS,
  type SpecialistName,
} from "@/agent/lib/specialists";
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
  assert.deepEqual(result, { ...envelope, specialist: "lead-operations" });
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

test("the orchestrator and every specialist are told the current Sydney date", () => {
  for (const dir of [
    path.join(REPO_ROOT, "agent"),
    ...declaredSpecialists().map((name) => path.join(SUBAGENTS_DIR, name)),
  ]) {
    const file = path.join(dir, "instructions", "current-time.ts");
    assert.ok(existsSync(file), `${file} is missing`);
    assert.ok(
      readFileSync(file, "utf8").includes(
        'import currentTimeInstructions from "@/agent/lib/current-time-instructions";',
      ),
      `${file} imports the shared current-time instruction`,
    );
  }
});
