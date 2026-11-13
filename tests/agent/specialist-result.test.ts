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
import { toolOutcome } from "@/components/agent/agent-format";
import { delegateEnvelopes } from "@/evals/helpers/envelope";

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

  it("rejects punctuation-only text", () => {
    for (const text of ["...", "-", "—", "?!"]) {
      assert.equal(
        judgeSpecialistResult({ kind: "entity-summary", summary: text, title: text })
          .usable,
        false,
        text,
      );
    }
  });

  it("keeps a real record that happens to be called Test", () => {
    const verdict = judgeSpecialistResult({
      ...projectResult,
      entityRef: { display: { label: "Test" }, id: "l9", type: "lead" },
      summary: "Stage Quoted; follow-up due Friday.",
      title: "Test",
    });
    assert.ok(verdict.usable);
    // Without a record behind it, the same title is a placeholder.
    assert.equal(
      judgeSpecialistResult({ kind: "entity-summary", summary: "Found it.", title: "Test" })
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

  it("still validates the rest of the envelope", async () => {
    // Guards against eve degrading the extended schema to "accept anything",
    // which would end the model's in-loop correction on a malformed answer.
    for (const bad of [
      { ...projectResult, title: undefined },
      { ...projectResult, kind: "nonsense" },
    ]) {
      const result = await validate(bad);
      assert.ok(result.issues?.length, JSON.stringify(bad));
    }
  });

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

  it("tells the specialist a read-only task changes nothing, on both attempts", async () => {
    const { ctx, messages } = scripted(probe, projectResult);
    await runDelegate({ ...single, readOnly: true }, ctx);
    for (const message of messages) assert.match(message, /read-only lookup: change nothing/);
  });

  it("does not retry an answer that says it reached an approval", async () => {
    const { ctx, messages } = scripted({ ...probe, requiresApproval: true }, projectResult);
    await assert.rejects(runDelegate({ ...single, readOnly: true }, ctx));
    assert.equal(messages.length, 1);
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
    assert.match(result.results[0]?.summary ?? "", /may have done so before failing/);
    assert.match(result.summary, /0 of 2 tasks finished/);
  });
});

describe("the tool card outcome", () => {
  it("is failed for an error envelope and for a team where every task failed", () => {
    assert.deepEqual(toolOutcome({ kind: "error", summary: "x", title: "x" }), {
      failed: true,
      note: null,
    });
    const allFailed = toolOutcome({
      results: [{ kind: "error" }, { kind: "error" }],
      summary: "0 of 2 tasks finished; not finished: a, b.",
    });
    assert.equal(allFailed.failed, true);
  });

  it("names a partial team failure without calling the whole call failed", () => {
    const outcome = toolOutcome({
      results: [{ kind: "entity-summary" }, { kind: "error" }],
      summary: "1 of 2 tasks finished; not finished: b.",
    });
    assert.deepEqual(outcome, {
      failed: false,
      note: "1 of 2 tasks finished; not finished: b.",
    });
  });

  it("is a plain success otherwise", () => {
    assert.deepEqual(toolOutcome(projectResult), { failed: false, note: null });
    assert.deepEqual(
      toolOutcome({ results: [{ kind: "entity-summary" }], summary: "1 of 1 tasks finished." }),
      { failed: false, note: null },
    );
  });
});

describe("the eval's view of a delegate result", () => {
  it("reads the single form and each task of a team", () => {
    assert.deepEqual(delegateEnvelopes(projectResult), [projectResult]);
    assert.deepEqual(
      delegateEnvelopes({ results: [projectResult, probe], summary: "" }),
      [projectResult, probe],
    );
    assert.deepEqual(delegateEnvelopes(undefined), []);
  });
});
