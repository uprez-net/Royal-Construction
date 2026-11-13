import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, it, vi } from "vitest";
import type { Assertion, AssertionHandle, EveEvalContext } from "eve/evals";
import documentInjection from "@/evals/safety/document-injection.eval";
import errorSurfacing from "@/evals/safety/error-surfacing.eval";
import { REPO_ROOT } from "../support/repo-root";

afterEach(() => {
  vi.unstubAllEnvs();
});

function contextWith(outputs: readonly unknown[] = []) {
  const checks: { label?: string; score: Promise<number> }[] = [];
  const handle: AssertionHandle = {
    gate() {
      return this;
    },
    soft() {
      return this;
    },
    atLeast() {
      return this;
    },
    label() {
      return this;
    },
  };
  const send = vi
    .fn<(message: unknown) => Promise<unknown>>()
    .mockResolvedValue({
      expectOk() {},
      session: {
        events: outputs.map((output, index) => ({
          type: "action.result",
          data: {
            status: "completed",
            result: {
              kind: "tool-result",
              callId: `call_${index}`,
              toolName: "search_leads",
              output,
            },
          },
        })),
      },
    });
  const context = {
    send,
    session: async () => ({
      sendFile: async () => {
        throw new Error("The requested agent session is unavailable.");
      },
    }),
    succeeded: () => handle,
    notEvent: () => handle,
    judge: () => handle,
    check(value: unknown, assertion: Assertion) {
      const check = {
        label: undefined as string | undefined,
        score: Promise.resolve(assertion.score(value)),
      };
      checks.push(check);
      return {
        ...handle,
        label(label: string) {
          check.label = label;
          return this;
        },
      };
    },
  } as unknown as EveEvalContext;
  return { context, send, checks };
}

const missingName = "Nonexistent Placeholder Client";
const emptySearch = {
  version: 1,
  kind: "entity-summary",
  title: "Lead search results",
  summary: "No leads on page 1; 0 authorized leads matched in all.",
  data: { leads: [], query: missingName, totalCount: 0 },
};

it("does not treat a query echoed by an empty search as a fabricated lead", async () => {
  const { context, checks } = contextWith([emptySearch]);
  await errorSurfacing.test(context);
  const check = checks.find((check) => check.label === "no fabricated entity");
  assert.ok(check);
  assert.equal(await check.score, 1);
});

for (const fabricated of [
  {
    ...emptySearch,
    title: missingName,
    summary: "This lead is at the Quoted stage.",
  },
  {
    ...emptySearch,
    data: {
      ...emptySearch.data,
      leads: [{ name: missingName, stage: "Quoted" }],
    },
  },
]) {
  it(`still rejects a fabricated lead in ${fabricated.title === missingName ? "the summary" : "search records"}`, async () => {
    const { context, checks } = contextWith([fabricated]);
    await errorSurfacing.test(context);
    const check = checks.find(
      (check) => check.label === "no fabricated entity",
    );
    assert.ok(check);
    assert.equal(await check.score, 0);
  });
}

it("sends the injection document with the first message instead of prewarming", async () => {
  const { context, send } = contextWith();
  await documentInjection.test(context);
  assert.equal(send.mock.calls.length, 1);
  const parts = send.mock.calls[0][0];
  assert.ok(Array.isArray(parts));
  const file = parts.find((part) => part.type === "file");
  assert.equal(file?.mediaType, "text/plain");
  assert.equal(file?.filename, "untrusted-note.txt");
  assert.equal(
    Buffer.from(String(file.data).split(",")[1], "base64").toString("utf8"),
    await readFile(`${REPO_ROOT}/evals/data/untrusted-note.txt`, "utf8"),
  );
  assert.ok(
    parts.some(
      (part) => part.type === "text" && part.text.includes("Summarise"),
    ),
  );
});

it("defaults the judge to a decision model supported by Eve", async () => {
  vi.stubEnv("EVE_EVAL_JUDGE_MODEL", "");
  vi.resetModules();
  const { default: config } = await import("@/evals/evals.config");
  assert.equal(config.judge?.model, "typesafe-ai/jev");
});

it("preserves an explicit judge override", async () => {
  vi.stubEnv("EVE_EVAL_JUDGE_MODEL", " typesafe-ai/custom-decision-model ");
  vi.resetModules();
  const { default: config } = await import("@/evals/evals.config");
  assert.equal(config.judge?.model, "typesafe-ai/custom-decision-model");
});
