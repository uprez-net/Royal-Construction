import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/data/agent-session-titles", () => ({
  getAgentSessionTitle: async () => "Already titled",
  setAgentSessionTitleIfMissing: async () => undefined,
}));

const { createAgentEventPersister } =
  await import("@/agent/lib/event-persistence");

type Batch = { eventTypes: string[] };

function recordingStore(options: { failFirst?: number } = {}) {
  const batches: Batch[] = [];
  let failures = options.failFirst ?? 0;
  return {
    batches,
    store: {
      async writeBatch(_identity: unknown, batch: { eventType: string }[]) {
        if (failures > 0) {
          failures -= 1;
          throw new Error("database unavailable");
        }
        batches.push({ eventTypes: batch.map((event) => event.eventType) });
      },
    },
  };
}

let sequence = 0;
function event(type: string, data: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    type,
    data: { turnId: "turn_0", ...data },
    meta: {
      id: `evt_${String(sequence).padStart(4, "0")}`,
      at: new Date(Date.UTC(2026, 10, 13, 1, 0, sequence)).toISOString(),
    },
  } as never;
}

const ctx = {
  agent: { name: "guri" },
  channel: {},
  session: {
    id: "wrun_session",
    parent: undefined,
    auth: { initiator: { principalType: "user", principalId: "user_1" } },
  },
} as never;

const noTitle = async () => null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a streaming delta returns without waiting for the database", async () => {
  let release: () => void = () => undefined;
  const store = {
    writeBatch: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  };
  const persist = createAgentEventPersister(noTitle, store);

  // Resolves immediately even though the store would block forever.
  await persist(event("reasoning.appended", { reasoningDelta: "a" }), ctx);
  await persist(event("message.appended", { messageDelta: "b" }), ctx);
  release();
});

test("a boundary event writes the queued deltas and itself in one batch", async () => {
  const { batches, store } = recordingStore();
  const persist = createAgentEventPersister(noTitle, store);

  await persist(event("step.started"), ctx);
  await persist(event("message.appended", { messageDelta: "Hel" }), ctx);
  await persist(event("message.appended", { messageDelta: "lo" }), ctx);
  assert.equal(batches.length, 1, "deltas are not written one by one");

  await persist(event("message.completed", { message: "Hello" }), ctx);
  assert.deepEqual(batches, [
    { eventTypes: ["step.started"] },
    {
      eventTypes: ["message.appended", "message.appended", "message.completed"],
    },
  ]);
});

test("deltas with no boundary behind them are still written", async () => {
  const { batches, store } = recordingStore();
  const persist = createAgentEventPersister(noTitle, store);

  await persist(event("reasoning.appended", { reasoningDelta: "x" }), ctx);
  assert.equal(batches.length, 0);
  await vi.advanceTimersByTimeAsync(1_000);
  assert.deepEqual(batches, [{ eventTypes: ["reasoning.appended"] }]);
});

test("a failed background write is retried, in order, by the next boundary", async () => {
  const { batches, store } = recordingStore({ failFirst: 1 });
  const persist = createAgentEventPersister(noTitle, store);
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

  await persist(event("message.appended", { messageDelta: "a" }), ctx);
  await vi.advanceTimersByTimeAsync(1_000);
  assert.equal(batches.length, 0);
  assert.equal(logged.mock.calls.length, 1);

  await persist(event("message.completed", { message: "a" }), ctx);
  assert.deepEqual(batches, [
    { eventTypes: ["message.appended", "message.completed"] },
  ]);
  logged.mockRestore();
});

test("a boundary whose write fails still fails, as the per-event write did", async () => {
  const { store } = recordingStore({ failFirst: 1 });
  const persist = createAgentEventPersister(noTitle, store);

  await assert.rejects(
    () => persist(event("session.started"), ctx),
    /database unavailable/,
  );
});

test("a session that is not a signed-in user's is not persisted", async () => {
  const { batches, store } = recordingStore();
  const persist = createAgentEventPersister(noTitle, store);
  const serviceCtx = {
    ...(ctx as object),
    session: {
      id: "wrun_service",
      parent: undefined,
      auth: { initiator: { principalType: "service", principalId: "cron" } },
    },
  } as never;

  await persist(event("session.started"), serviceCtx);
  assert.equal(batches.length, 0);
});

test("a boundary waits for a background write in flight, then writes what queued behind it", async () => {
  const calls: string[][] = [];
  let releaseFirst: () => void = () => undefined;
  const store = {
    writeBatch(_identity: unknown, batch: { eventType: string }[]) {
      calls.push(batch.map((event) => event.eventType));
      if (calls.length > 1) return Promise.resolve();
      return new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    },
  };
  const persist = createAgentEventPersister(noTitle, store);

  await persist(event("message.appended", { messageDelta: "a" }), ctx);
  await vi.advanceTimersByTimeAsync(1_000);
  assert.deepEqual(
    calls,
    [["message.appended"]],
    "the first write is in flight",
  );

  await persist(event("reasoning.appended", { reasoningDelta: "b" }), ctx);
  let boundaryDone = false;
  const boundary = persist(
    event("message.completed", { message: "a" }),
    ctx,
  ).then(() => {
    boundaryDone = true;
  });
  await vi.advanceTimersByTimeAsync(1_000);
  assert.equal(boundaryDone, false, "the boundary waits for the first write");
  assert.equal(calls.length, 1, "nothing overtakes the write in flight");

  releaseFirst();
  await boundary;
  assert.deepEqual(calls, [
    ["message.appended"],
    ["reasoning.appended", "message.completed"],
  ]);
});

// #615: a NUL in a tool result used to fail the turn, and the batch holding it
// went back to the front of the queue to fail every later boundary too.

test("an event with a NUL or a lone surrogate in a nested string is cleaned for jsonb", async () => {
  const { toInputJson } = await import("@/agent/lib/event-persistence");
  const nul = String.fromCharCode(0);
  const loneHigh = String.fromCharCode(0xd83d);
  const loneLow = String.fromCharCode(0xde00);
  const replacement = String.fromCharCode(0xfffd);
  const emoji = String.fromCodePoint(0x1f600);
  const cleaned = toInputJson({
    type: "action.result",
    data: {
      output: {
        text: `page${nul}one`,
        lines: [`a${nul}b`, `broken ${loneHigh}`],
      },
      [`key${nul}`]: `${loneLow} low`,
      intact: `emoji ${emoji} stays`,
    },
  });
  assert.deepEqual(cleaned, {
    type: "action.result",
    data: {
      output: { text: "pageone", lines: ["ab", `broken ${replacement}`] },
      key: `${replacement} low`,
      intact: `emoji ${emoji} stays`,
    },
  });
  // What jsonb refuses is the escape JSON.stringify writes for these.
  assert.doesNotMatch(JSON.stringify(cleaned), /\\u0000|\\ud[89a-f]/i);
});

test("a stored event with a NUL in it reaches the store without one", async () => {
  const payloads: unknown[] = [];
  const store = {
    async writeBatch(_identity: unknown, batch: { payload: unknown }[]) {
      payloads.push(...batch.map((event) => event.payload));
    },
  };
  const persist = createAgentEventPersister(noTitle, store);
  await persist(
    event("action.result", { output: `ocr${String.fromCharCode(0)}text` }),
    ctx,
  );
  assert.equal(
    (payloads[0] as { data: { output: string } }).data.output,
    "ocrtext",
  );
});

function postgresDataError() {
  return Object.assign(
    new Error(
      "Invalid `prisma.agentSessionEvent.createMany()` invocation:\nDatabase error. Code: `22P05`. Message: `unsupported Unicode escape sequence`",
    ),
    { name: "PrismaClientUnknownRequestError" },
  );
}

test("a batch Postgres refuses for its content does not block the next boundary write", async () => {
  const written: { eventType: string; payload: unknown }[][] = [];
  const store = {
    async writeBatch(
      _identity: unknown,
      batch: { eventType: string; payload: unknown }[],
    ) {
      // Refuse any write that still holds the poisoned result.
      if (
        batch.some(
          (entry) =>
            (entry.payload as { data?: { output?: string } }).data?.output
            === "refused",
        )
      ) {
        throw postgresDataError();
      }
      written.push(batch);
    },
  };
  const persist = createAgentEventPersister(noTitle, store);
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

  await persist(event("message.appended", { messageDelta: "a" }), ctx);
  // The boundary does not throw: the turn goes on.
  await persist(event("action.result", { output: "refused" }), ctx);
  await persist(event("step.completed"), ctx);

  const types = written.map((batch) => batch.map((entry) => entry.eventType));
  assert.deepEqual(types, [
    ["message.appended"],
    ["action.result"],
    ["step.completed"],
  ]);
  const marker = written[1]![0]!.payload as Record<string, unknown>;
  assert.equal(marker.omitted, true);
  assert.equal(marker.type, "action.result");
  assert.equal("meta" in marker, false, "a marker is not a hydratable event");
  assert.equal(logged.mock.calls.length, 1);
  logged.mockRestore();
});

test("an owner mismatch still fails the turn and is retried, not replaced", async () => {
  const { AgentSessionOwnerMismatchError } =
    await import("@/agent/lib/event-persistence");
  const attempts: string[][] = [];
  const store = {
    async writeBatch(_identity: unknown, batch: { eventType: string }[]) {
      attempts.push(batch.map((entry) => entry.eventType));
      throw new AgentSessionOwnerMismatchError();
    },
  };
  const persist = createAgentEventPersister(noTitle, store);

  await assert.rejects(
    () => persist(event("session.started"), ctx),
    /owner mismatch/,
  );
  await assert.rejects(
    () => persist(event("turn.started"), ctx),
    /owner mismatch/,
  );
  assert.deepEqual(attempts, [
    ["session.started"],
    ["session.started", "turn.started"],
  ]);
});

test("only a data exception counts as an unstorable payload", async () => {
  const { isUnstorablePayloadError, AgentSessionOwnerMismatchError } =
    await import("@/agent/lib/event-persistence");
  assert.equal(isUnstorablePayloadError(postgresDataError()), true);
  assert.equal(
    isUnstorablePayloadError({ code: "P2010", meta: { code: "22021" } }),
    true,
  );
  assert.equal(
    isUnstorablePayloadError(new Error("database unavailable")),
    false,
  );
  assert.equal(
    isUnstorablePayloadError(new AgentSessionOwnerMismatchError()),
    false,
  );
  assert.equal(isUnstorablePayloadError({ code: "P1001" }), false);
});
