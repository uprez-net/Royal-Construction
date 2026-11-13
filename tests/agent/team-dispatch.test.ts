import assert from "node:assert/strict";
import { test } from "vitest";

import { briefFor, planWaves, type TeamTask } from "@/agent/lib/team-dispatch";
import delegate from "@/agent/tools/delegate";

// `delegate` with `tasks`: independent specialists start together, and a
// task that depends on another starts from its findings instead of searching
// again. These pin both halves, and that a failure in a team is said plainly
// rather than swallowed.

const lead: TeamTask = {
  id: "lead",
  request: "Open Smith.",
  specialist: "lead-operations",
};
const project: TeamTask = {
  id: "project",
  request: "Rose St progress.",
  specialist: "project-operations",
};
const offer: TeamTask = {
  after: ["lead"],
  id: "offer",
  request: "Smith's offer status.",
  specialist: "offer-operations",
};

test("independent tasks share a wave; dependents wait", () => {
  const waves = planWaves([lead, project, offer]).map((wave) =>
    wave.map((task) => task.id),
  );
  assert.deepEqual(waves, [["lead", "project"], ["offer"]]);
});

test("a plan that cannot run is refused, not reordered", () => {
  assert.throws(
    () => planWaves([{ ...lead, after: ["ghost"] }]),
    /unknown task/,
  );
  assert.throws(() => planWaves([{ ...lead, after: ["lead"] }]), /itself/);
  assert.throws(
    () =>
      planWaves([
        { ...lead, after: ["offer"] },
        { ...offer, after: ["lead"] },
      ]),
    /circle/,
  );
});

test("a lone task with nothing to share is sent exactly as written", () => {
  assert.equal(briefFor(lead, { findings: {}, teamSize: 1 }), "Open Smith.");
});

test("a dependent task is briefed with its teammate's record", () => {
  const brief = briefFor(offer, {
    findings: {
      lead: {
        entityRef: {
          display: { label: "Smith — 12 Rose St" },
          id: "42",
          type: "lead",
        },
        kind: "entity-summary",
        specialist: "lead-operations",
        summary: "Stage: quoted.",
        title: "Smith — 12 Rose St",
      },
    },
    goal: "Where is Smith up to?",
    sharedContext: "Smith lead leadId=42",
    teamSize: 3,
  });
  assert.match(brief, /one of 3 specialists/);
  assert.match(brief, /Goal: Where is Smith up to\?/);
  assert.match(brief, /leadId=42/);
  assert.match(brief, /use their record ids instead of searching again/);
  assert.match(brief, /Your task: Smith's offer status\./);
});

type DelegateContext = {
  agents: Record<string, { description: string }>;
  agent: (target: string, input: { message: string }) => Promise<unknown>;
};

const runDelegate = delegate.execute as unknown as (
  input: Record<string, unknown>,
  ctx: DelegateContext,
) => Promise<Record<string, unknown>>;

const allAgents = {
  "lead-operations": { description: "" },
  "offer-operations": { description: "" },
  "project-operations": { description: "" },
};

test("tasks in one wave run at the same time", async () => {
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = runDelegate(
    { tasks: [lead, project] },
    {
      agent: async (target) => {
        started.push(target);
        await gate;
        return {
          kind: "entity-summary",
          summary: "Found.",
          title: target,
          version: 1,
        };
      },
      agents: allAgents,
    },
  );
  // Both specialists have started before either has finished.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started.sort(), ["lead-operations", "project-operations"]);
  release();
  const result = (await running) as { results: { task: string }[] };
  assert.deepEqual(
    result.results.map((entry) => entry.task),
    ["lead", "project"],
  );
});

test("a dependent task receives what its teammate found", async () => {
  const messages: Record<string, string> = {};
  await runDelegate(
    { goal: "Smith overview", tasks: [lead, offer] },
    {
      agent: async (target, input) => {
        messages[target] = input.message;
        return target === "lead-operations"
          ? {
              entityRef: {
                display: { label: "Smith" },
                id: "42",
                type: "lead",
              },
              kind: "entity-summary",
              summary: "Quoted.",
              title: "Smith",
              version: 1,
            }
          : {
              kind: "entity-summary",
              summary: "Found.",
              title: "Offer",
              version: 1,
            };
      },
      agents: allAgents,
    },
  );
  assert.match(messages["offer-operations"] ?? "", /leadId=42/);
  assert.doesNotMatch(messages["lead-operations"] ?? "", /teammates found/);
});

test("in a team, a failed task is reported and its dependents are skipped", async () => {
  const result = (await runDelegate(
    { tasks: [lead, project, offer] },
    {
      agent: async (target) => {
        if (target === "lead-operations")
          throw new Error("SESSION_TOKEN_LIMIT_REACHED");
        return {
          kind: "entity-summary",
          summary: "Found.",
          title: target,
          version: 1,
        };
      },
      agents: allAgents,
    },
  )) as {
    results: { task: string; kind: string; summary: string }[];
    summary: string;
  };
  const byTask = Object.fromEntries(result.results.map((r) => [r.task, r]));
  assert.equal(byTask.lead?.kind, "error");
  assert.match(byTask.lead?.summary ?? "", /Do not assume/);
  assert.equal(byTask.project?.kind, "entity-summary");
  assert.equal(byTask.offer?.kind, "error");
  assert.match(byTask.offer?.summary ?? "", /Not started because lead/);
  assert.match(result.summary, /1 of 3 tasks finished/);
});

test("a teammate's plain-text reply is not a result: its dependents do not start", async () => {
  // Every specialist has an output schema, so eve never hands back plain text.
  // If something ever did, it is not an answer to build on.
  const called: string[] = [];
  const result = (await runDelegate(
    { tasks: [lead, offer] },
    {
      agent: async (target) => {
        called.push(target);
        return target === "lead-operations"
          ? "Smith is lead 42, stage Quoted."
          : {
              kind: "entity-summary",
              summary: "Found.",
              title: "Offer",
              version: 1,
            };
      },
      agents: allAgents,
    },
  )) as { results: { task: string; kind: string }[]; summary: string };
  assert.deepEqual(called, ["lead-operations"]);
  assert.match(result.summary, /0 of 2 tasks finished/);
});

test("a teammate that answered with an error envelope stops its dependents", async () => {
  const called: string[] = [];
  const result = (await runDelegate(
    { tasks: [lead, offer] },
    {
      agent: async (target) => {
        called.push(target);
        return target === "lead-operations"
          ? {
              kind: "error",
              summary: "No lead matches Smith.",
              title: "Not found",
              version: 1,
            }
          : {
              kind: "entity-summary",
              summary: "Found.",
              title: "Offer",
              version: 1,
            };
      },
      agents: allAgents,
    },
  )) as {
    results: { task: string; kind: string; summary: string }[];
    summary: string;
  };
  assert.deepEqual(called, ["lead-operations"]);
  const byTask = Object.fromEntries(result.results.map((r) => [r.task, r]));
  assert.match(byTask.offer?.summary ?? "", /Not started because lead/);
  assert.match(result.summary, /0 of 2 tasks finished/);
});
