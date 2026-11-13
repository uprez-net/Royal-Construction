import assert from "node:assert/strict";
import { describe, it } from "vitest";
// Not in eve's export map. Imported by path so this pins the installed eve's
// real lowering, not a reimplementation of it.
import {
  serializeOutputSchema,
  toInputSchema,
} from "../../node_modules/eve/dist/src/tools/schema.js";
import {
  judgeSpecialistResult,
  specialistOutputSchema,
} from "@/agent/lib/specialist-result";
import delegate from "@/agent/tools/delegate";

// The staging failure (13 Nov 2026): the project specialist read the project,
// had its real answer rejected by eve three times on `version`, then submitted
// `{ title: "test", summary: "test", data: { ok: true } }` as a probe. It
// parsed, so the person saw a green "Complete" card with nothing behind it.
const probe = {
  data: { ok: true },
  kind: "entity-summary",
  summary: "test",
  title: "test",
  version: 1,
};

const projectResult = {
  data: { milestonesComplete: 2, milestonesTotal: 82 },
  entityRef: {
    display: { label: "20 Massey Street, Oran Park" },
    id: "p1",
    type: "project",
  },
  kind: "entity-summary",
  summary: "2 of 82 milestones complete; frame stage next.",
  title: "20 Massey Street, Oran Park",
};

describe("judgeSpecialistResult", () => {
  it("rejects the placeholder probe", () => {
    const verdict = judgeSpecialistResult(probe);
    assert.equal(verdict.usable, false);
    assert.equal(
      judgeSpecialistResult({ ...probe, kind: "confirmation", title: "Test." })
        .usable,
      false,
    );
  });

  it("rejects an empty summary, a missing title and a non-envelope", () => {
    assert.equal(
      judgeSpecialistResult({ ...projectResult, summary: "  " }).usable,
      false,
    );
    assert.equal(
      judgeSpecialistResult({ ...projectResult, title: undefined }).usable,
      false,
    );
    assert.equal(judgeSpecialistResult("Done.").usable, false);
    assert.equal(judgeSpecialistResult(null).usable, false);
  });

  it("stamps version 1 whatever the model wrote, and keeps a real answer", () => {
    for (const version of [undefined, 1, "1"]) {
      const verdict = judgeSpecialistResult({ ...projectResult, version });
      assert.ok(verdict.usable);
      assert.equal(verdict.envelope.version, 1);
      assert.equal(verdict.envelope.title, projectResult.title);
    }
  });

  it("keeps an honest 'nothing matched' answer with no record and no data", () => {
    const verdict = judgeSpecialistResult({
      kind: "entity-summary",
      summary: "No project matches 12 Nowhere Road.",
      title: "No matching project",
    });
    assert.ok(verdict.usable);
  });
});

describe("the specialist output schema as eve lowers it", () => {
  // eve turns the outputSchema into a `final_output` tool through these two
  // calls; this is the validator the model's answer actually meets.
  const lowered = toInputSchema(serializeOutputSchema(specialistOutputSchema));
  const validate = (value: unknown) =>
    lowered["~standard"].validate(value) as
      | { issues?: undefined; value: unknown }
      | { issues: readonly { message: string }[] };

  it("accepts a result with version missing, 1 or '1'", async () => {
    for (const version of [undefined, 1, "1"]) {
      const result = await validate({ ...projectResult, version });
      assert.equal(result.issues, undefined, JSON.stringify(result.issues));
    }
  });
});

type DelegateContext = {
  agents: Record<string, { description: string }>;
  agent: (target: string, input: { message: string }) => Promise<unknown>;
};
const runDelegate = delegate.execute as unknown as (
  input: Record<string, unknown>,
  ctx: DelegateContext,
) => Promise<Record<string, unknown>>;
const agents = { "project-operations": { description: "" } };

function scripted(...answers: unknown[]) {
  const messages: string[] = [];
  return {
    messages,
    ctx: {
      agent: async (_target: string, input: { message: string }) => {
        messages.push(input.message);
        return answers.shift();
      },
      agents,
    } satisfies DelegateContext,
  };
}

describe("delegate with an unusable specialist result", () => {
  const single = {
    request: "Full project details for 20 Massey Street, Oran Park.",
    specialist: "project-operations",
  };

  it("fails the call instead of returning the placeholder", async () => {
    const { ctx, messages } = scripted(probe);
    await assert.rejects(runDelegate(single, ctx), /did not return a usable result/);
    // Not marked read-only: never re-run, it may have changed something.
    assert.equal(messages.length, 1);
  });

  it("retries a read-only lookup once and returns the real answer", async () => {
    const { ctx, messages } = scripted(probe, projectResult);
    const result = await runDelegate({ ...single, readOnly: true }, ctx);
    assert.equal(messages.length, 2);
    assert.match(messages[1] ?? "", /change nothing/);
    assert.equal(result.title, projectResult.title);
    assert.equal(result.version, 1);
    assert.equal(result.specialist, "project-operations");
  });

  it("retries only once, then fails loudly", async () => {
    const { ctx, messages } = scripted(probe, probe, projectResult);
    await assert.rejects(
      runDelegate({ ...single, readOnly: true }, ctx),
      /even after one automatic retry/,
    );
    assert.equal(messages.length, 2);
  });

  it("in a team, the unusable task is an error and its dependents do not start", async () => {
    const { ctx, messages } = scripted(probe);
    const result = (await runDelegate(
      {
        tasks: [
          { id: "project", request: "Find Massey St.", specialist: "project-operations" },
          {
            after: ["project"],
            id: "detail",
            request: "Its milestones.",
            specialist: "project-operations",
          },
        ],
      },
      ctx,
    )) as { results: { task: string; kind: string; summary: string }[]; summary: string };
    assert.equal(messages.length, 1);
    assert.equal(result.results[0]?.kind, "error");
    assert.match(result.results[0]?.summary ?? "", /may have changed something/);
    assert.match(result.summary, /0 of 2 tasks finished/);
  });
});
