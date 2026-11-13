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
