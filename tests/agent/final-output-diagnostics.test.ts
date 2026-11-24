import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/data/agent-session-titles", () => ({
  getAgentSessionTitle: async () => "Already titled",
  setAgentSessionTitleIfMissing: async () => undefined,
}));

const { finalOutputIssues, FINAL_OUTPUT_DIAGNOSTIC_EVENT } =
  await import("@/agent/lib/final-output-diagnostics");
const { specialistResultSchema } = await import("@/agent/lib/result-contracts");
const { createAgentEventPersister } =
  await import("@/agent/lib/event-persistence");

// #619: 19 of 148 specialist turns spent 17-39 s on extra model steps because
// eve refused their final answer, and nothing recorded why.

const valid = JSON.stringify({
  data: {},
  kind: "entity-summary",
  summary: "Two milestones are due this week.",
  title: "Milestones due",
  warnings: [],
});

describe("finalOutputIssues", () => {
  it("finds nothing wrong with a valid answer", () => {
    assert.deepEqual(finalOutputIssues(valid, specialistResultSchema), []);
  });

  it("names the failing field and the kind of failure, never the value", () => {
    const issues = finalOutputIssues(
      JSON.stringify({
        kind: "entity-summary",
        summary: 42,
        title: "Client A, 12 Example St",
      }),
      specialistResultSchema,
    );
    const summary = issues.find((issue) => issue.path === "summary");
    assert.ok(summary, JSON.stringify(issues));
    assert.equal(summary.code, "invalid_type");
    assert.doesNotMatch(JSON.stringify(issues), /Client A|Example St/);
  });

  it("reports an answer that is not complete JSON at the root", () => {
    const [issue] = finalOutputIssues(
      '{"kind": "entity-',
      specialistResultSchema,
    );
    assert.equal(issue?.code, "invalid_json");
    assert.equal(issue?.path, "");
  });
});

let sequence = 0;
function event(type: string, data: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    data: { stepIndex: 0, turnId: "turn_0", ...data },
    meta: {
      at: new Date(Date.UTC(2026, 10, 24, 1, 0, sequence)).toISOString(),
      id: `evt_${String(sequence).padStart(4, "0")}`,
    },
    type,
  } as never;
}

function context(parent: boolean) {
  return {
    agent: { name: "project-operations" },
    channel: {},
    session: {
      auth: { initiator: { principalId: "user_1", principalType: "user" } },
      id: parent ? "wrun_child" : "wrun_root",
      parent: parent
        ? { rootSessionId: "wrun_root", sessionId: "wrun_root" }
        : undefined,
    },
  } as never;
}

function recording() {
  const written: { eventType: string; payload: unknown }[] = [];
  return {
    store: {
      async writeBatch(
        _identity: unknown,
        batch: { eventType: string; payload: unknown }[],
      ) {
        written.push(...batch);
      },
    },
    written,
  };
}

async function attempt(isSpecialist: boolean, inputText: string) {
  const { store, written } = recording();
  const persist = createAgentEventPersister(async () => null, store);
  const ctx = context(isSpecialist);
  // Streamed in two pieces, as the model writes it.
  const half = Math.floor(inputText.length / 2);
  for (const piece of [inputText.slice(0, half), inputText.slice(half)]) {
    await persist(
      event("action.input.appended", {
        callId: "call_final",
        inputTextDelta: piece,
        toolName: "final_output",
      }),
      ctx,
    );
  }
  await persist(event("step.completed"), ctx);
  return written;
}

describe("the persistence hook", () => {
  it("records why a specialist's final answer failed, beside the step", async () => {
    const written = await attempt(
      true,
      JSON.stringify({ kind: "entity-summary", title: "Client A" }),
    );
    const diagnostic = written.find(
      (row) => row.eventType === FINAL_OUTPUT_DIAGNOSTIC_EVENT,
    );
    assert.ok(diagnostic, "a diagnostic row is written");
    const payload = diagnostic.payload as {
      callId: string;
      issues: { path: string }[];
    };
    assert.equal(payload.callId, "call_final");
    assert.ok(payload.issues.some((issue) => issue.path === "summary"));
    assert.doesNotMatch(JSON.stringify(payload), /Client A/);
    assert.equal("meta" in (payload as object), false, "not hydratable");
  });

  it("writes nothing extra for a valid answer", async () => {
    const written = await attempt(true, valid);
    assert.equal(
      written.some((row) => row.eventType === FINAL_OUTPUT_DIAGNOSTIC_EVENT),
      false,
    );
  });

  it("never diagnoses the conversation itself", async () => {
    const written = await attempt(false, '{"kind":');
    assert.equal(
      written.some((row) => row.eventType === FINAL_OUTPUT_DIAGNOSTIC_EVENT),
      false,
    );
  });
});
