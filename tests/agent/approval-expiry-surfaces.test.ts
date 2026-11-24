import assert from "node:assert/strict";
import { AgentSessionStatus } from "@prisma/client";
import { describe, it, vi } from "vitest";

import { formatSydneyDate } from "@/lib/dates/sydney";

vi.mock("@/lib/prisma", () => ({ default: {} }));

const { ownerMayApprove } = await import("@/agent/lib/agent-approval");
const { sessionStatusAfter } = await import("@/agent/lib/event-persistence");
const { pendingApprovalsText } =
  await import("@/agent/instructions/pending-approvals");
const { findCancelledApprovalRequestId, expiredApprovalInstructions } =
  await import("@/agent/lib/cancelled-approval");
const { cancelledChangeResult, EXPIRED_TITLE } =
  await import("@/agent/lib/team-dispatch");
const { approvalWaitingLabel } =
  await import("@/components/agent/agent-history");

// #617: the places an unanswered approval now shows, and the late approval
// that is now refused.

const owner = { principalId: "owner", principalType: "user" };

function decide(requestedAt: Date | null, now: string) {
  const policy = ownerMayApprove(
    async () => requestedAt,
    () => new Date(now),
  );
  return policy({
    request: { requestId: "req_1" },
    responder: owner,
    session: { initiator: owner },
  } as never);
}

describe("a late approval", () => {
  const asked = new Date("2026-11-10T05:00:00Z");

  it("is refused once the approval has expired, and says so", async () => {
    const decision = await decide(asked, "2026-11-24T05:00:00Z");
    assert.equal(decision.status, "rejected");
    assert.match(
      (decision as { reason: string }).reason,
      /expired at the end of/,
    );
  });

  it("is allowed before the deadline", async () => {
    assert.deepEqual(await decide(asked, "2026-11-10T06:00:00Z"), {
      status: "allowed",
    });
  });

  it("is allowed when the request is not on record", async () => {
    assert.deepEqual(await decide(null, "2026-11-24T05:00:00Z"), {
      status: "allowed",
    });
  });

  it("still refuses anyone but the owner first", async () => {
    const policy = ownerMayApprove(async () => null);
    const decision = await policy({
      request: { requestId: "req_1" },
      responder: { principalId: "stranger", principalType: "user" },
      session: { initiator: owner },
    } as never);
    assert.equal(decision.status, "rejected");
  });
});

describe("specialist session status", () => {
  it("completes a specialist session when its turn completes", () => {
    assert.equal(
      sessionStatusAfter("turn.completed", true),
      AgentSessionStatus.COMPLETED,
    );
  });

  it("leaves a conversation's status alone when its turn completes", () => {
    assert.equal(sessionStatusAfter("turn.completed", false), undefined);
  });

  it("still reads waiting for a parked session", () => {
    assert.equal(
      sessionStatusAfter("session.waiting", true),
      AgentSessionStatus.WAITING,
    );
  });
});

describe("the orchestrator is told what is waiting", () => {
  const approval = {
    batchRequestIds: ["req_1"],
    callId: "call_1",
    expiresAt: new Date("2026-11-25T12:59:59.999Z"),
    ownerUserId: "owner",
    requestId: "req_1",
    requestedAt: new Date("2026-11-24T05:03:00Z"),
    rootEveSessionId: "wrun_other",
    toolName: "create_milestone",
  };

  it("lists approvals waiting in other conversations", () => {
    const text = pendingApprovalsText([approval], "wrun_this");
    assert.ok(text);
    assert.match(text, /Approvals still waiting/);
    assert.match(text, /create_milestone/);
    assert.match(text, /never describe them as done/);
  });

  it("says nothing when the only one waiting is in this conversation", () => {
    assert.equal(pendingApprovalsText([approval], "wrun_other"), null);
  });
});

describe("an expired approval reads as not done", () => {
  it("finds the cancelled request in history", () => {
    const messages = [
      { content: "Create the slab milestone", role: "user" },
      {
        content: [
          {
            approvalId: "req_9",
            approved: false,
            type: "tool-approval-response",
          },
          {
            output: { type: "execution-denied" },
            toolName: "create_milestone",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ];
    assert.equal(findCancelledApprovalRequestId(messages), "req_9");
  });

  it("tells the specialist it expired, not that someone cancelled it", () => {
    const text = expiredApprovalInstructions("create_milestone");
    assert.match(text, /expired/);
    assert.match(text, /"expired": true/);
    assert.doesNotMatch(text, /pressed Cancel/);
  });

  it("fixes the words the office reads", () => {
    const result = cancelledChangeResult({
      data: { cancelled: true, change: "Slab milestone", expired: true },
      kind: "confirmation",
      summary: "model text",
      title: "model title",
      warnings: ["model warning"],
    });
    assert.ok(result);
    assert.equal(result.title, EXPIRED_TITLE);
    assert.match(result.summary, /^Not done: the approval .* expired/);
    assert.deepEqual(result.warnings, []);
  });
});

describe("the conversation list", () => {
  it("says an approval is waiting and when it expires", () => {
    assert.equal(
      approvalWaitingLabel(1, "2026-11-25T12:59:59.999Z"),
      `Approval waiting · expires ${formatSydneyDate(new Date("2026-11-25T12:59:59.999Z"))}`,
    );
    assert.equal(approvalWaitingLabel(3, null), "3 approvals waiting");
  });
});
