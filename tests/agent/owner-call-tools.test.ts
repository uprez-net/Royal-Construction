import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isHermesSession,
  NotHermesError,
  requireHermes,
} from "@/agent/lib/owner-calls";
import ownerCallTools from "@/agent/tools/owner_calls";

// The owner-call tools are Hermes's alone: offered on a turn whose caller
// carries the mark HERMES_MCP_SECRET gives (agent/lib/mcp-auth-policy.ts),
// and checked again inside each tool, since being offered is not permission.

function sessionWith(attributes: Record<string, string> | null) {
  return {
    session: {
      auth: {
        current: attributes
          ? {
              attributes,
              authenticator: "clerk",
              issuer: "clerk",
              principalId: "usr_1",
              principalType: "user" as const,
              subject: "user_clerk",
            }
          : null,
        initiator: null,
      },
      id: "ses_1",
      turn: { id: "turn_1" },
    },
  };
}

type Resolver = (event: unknown, ctx: unknown) => unknown;

function resolve(ctx: unknown) {
  const events = (
    ownerCallTools as unknown as {
      events: Record<string, Resolver>;
    }
  ).events;
  return events["turn.started"]({}, ctx);
}

test("a Hermes turn is offered the owner-call and handoff tools; anyone else, none", () => {
  const hermes = resolve(sessionWith({ hermes: "true", role: "ADMIN" }));
  assert.deepEqual(Object.keys(hermes as object).sort(), [
    "cancel_owner_call",
    "get_owner_call",
    "get_owner_call_handoff",
    "list_owner_call_handoffs",
    "list_owner_calls",
    "resolve_owner_call_handoff",
    "schedule_owner_call",
  ]);
  for (const ctx of [
    sessionWith({ role: "ADMIN" }),
    sessionWith({ hermes: "yes", role: "ADMIN" }),
    sessionWith(null),
  ]) {
    assert.equal(resolve(ctx), null);
  }
});

test("each tool refuses a caller who is not Hermes before reading anything", async () => {
  assert.equal(isHermesSession(sessionWith({ role: "ADMIN" })), false);
  await assert.rejects(
    requireHermes(sessionWith({ role: "ADMIN" }) as never),
    NotHermesError,
  );
});

test("resolving a handoff needs the revision the turn read", async () => {
  const { resolveHandoffInput, scheduleOwnerCallInput } =
    await import("@/agent/lib/owner-calls");
  assert.equal(
    resolveHandoffInput.safeParse({ handoff_id: "h-1", resolution: "done" })
      .success,
    false,
  );
  assert.equal(
    resolveHandoffInput.safeParse({
      handoff_id: "h-1",
      handoff_revision: 0,
      resolution: "done",
    }).success,
    true,
  );
  // Scheduling accepts the revision (the tool refuses a handoff_id without it).
  const base = {
    category: "other",
    idempotency_key: "k-1",
    subject: "s",
  };
  assert.equal(
    scheduleOwnerCallInput.safeParse({
      ...base,
      handoff_id: "h-1",
      handoff_revision: 2,
    }).success,
    true,
  );
  assert.equal(
    scheduleOwnerCallInput.safeParse({ ...base, handoff_revision: -1 }).success,
    false,
  );
});
