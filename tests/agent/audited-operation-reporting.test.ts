import assert from "node:assert/strict";
import { beforeEach, describe, test, vi } from "vitest";
import { z } from "zod";

const db = vi.hoisted(() => ({ failTheFailureWrite: false }));

const sdk = vi.hoisted(() => {
  const captured: unknown[] = [];
  const scope = {
    setTag() {},
    setContext() {},
    setUser() {},
    setLevel() {},
    setFingerprint() {},
  };
  return {
    captured,
    captureException: vi.fn((error: unknown) => void captured.push(error)),
    withScope: vi.fn((callback: (s: typeof scope) => void) => callback(scope)),
    flush: vi.fn(async () => true),
  };
});
vi.mock("@sentry/core", () => sdk);

// A transaction that records nothing and refuses nothing: this test is about
// what happens when `execute` throws, not about the audit rows.
const tx = {
  agentOperation: {
    findUnique: async () => null,
    create: async () => ({ id: "op_1" }),
    update: async (args: { data?: { failureReason?: string } }) => {
      // The write that records a failed operation, when the database is down.
      if (db.failTheFailureWrite && args.data?.failureReason) {
        throw new Error("database is unreachable");
      }
      return {};
    },
  },
  agentActionAudit: {
    create: async () => ({ id: "audit_1" }),
    update: async () => ({}),
  },
};
vi.mock("@/lib/prisma", () => ({
  default: { $transaction: async (run: (t: typeof tx) => unknown) => run(tx) },
}));
vi.mock("@/lib/domain/access/agent-sessions", () => ({
  authorizeAgentSession: async () => ({ agentSessionId: "agent_session_1" }),
}));
vi.mock("@/agent/lib/mutation-effects", () => ({
  mutationRefs: () => [],
  publishMutationEffects: async () => undefined,
}));

import {
  DomainSideEffectError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";

const ctx = {
  callId: "call_1",
  toolName: "send_quote_email",
  session: { id: "session_1", turn: { id: "turn_1" } },
} as never;

function run(execute: () => Promise<unknown>, transactional?: boolean) {
  return runAuditedAgentOperation({
    action: "send_quote_email",
    ctx,
    execute: execute as never,
    inputSummary: {},
    outputSchema: z.object({}).passthrough() as never,
    ownerUserId: "user_1",
    transactional,
  });
}

beforeEach(() => {
  sdk.captured.length = 0;
  db.failTheFailureWrite = false;
});

// The adapters above this turn a DomainError into a result the model reads
// back to the operator, so without a report here a failed email ends as chat
// text and nothing else.
describe("a failed audited agent write is reported before the adapter swallows it", () => {
  for (const transactional of [true, false]) {
    const mode = transactional ? "transactional" : "external side effect";

    test(`${mode}: the email that never went is reported, and still thrown`, async () => {
      const failure = new DomainSideEffectError("Email was not sent.", "email");
      await assert.rejects(
        () =>
          run(async () => {
            throw failure;
          }, transactional),
        failure,
      );
      assert.deepEqual(sdk.captured, [failure]);
    });

    test(`${mode}: an unexpected exception is reported, and still thrown`, async () => {
      const boom = new Error("connection reset");
      await assert.rejects(
        () =>
          run(async () => {
            throw boom;
          }, transactional),
        boom,
      );
      assert.deepEqual(sdk.captured, [boom]);
    });

    test(`${mode}: a refusal is thrown but NOT reported`, async () => {
      const refusal = new DomainValidationError("Add a reason first.");
      await assert.rejects(
        () =>
          run(async () => {
            throw refusal;
          }, transactional),
        refusal,
      );
      assert.equal(sdk.captured.length, 0);
    });
  }

  // A database outage is one of the likely reasons a write failed, and recording
  // the failure needs the database. Reported after that write, a rejected
  // finalisation threw first and the original failure was never reported.
  for (const transactional of [true, false]) {
    const mode = transactional ? "transactional" : "external side effect";

    test(`${mode}: the original failure is reported even if recording it fails`, async () => {
      db.failTheFailureWrite = true;
      const original = new DomainSideEffectError(
        "Email was not sent.",
        "email",
      );

      const thrown = await run(async () => {
        throw original;
      }, transactional).catch((e: unknown) => e);

      // Existing behaviour is kept: the finalisation failure is what propagates.
      assert.match((thrown as Error).message, /database is unreachable/);
      // But the failure that started it all was not lost.
      assert.deepEqual(sdk.captured, [original]);
    });
  }

  test("a write that succeeds reports nothing", async () => {
    await run(async () => ({}));
    assert.equal(sdk.captured.length, 0);
  });
});
