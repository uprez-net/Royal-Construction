import assert from "node:assert/strict";
import { describe, it } from "vitest";
// Not in eve's export map. Imported by path so this pins the installed eve's
// real resolution of an approval batch, not a reimplementation of it (#616).
import { resolveApprovalInputBatches } from "../../node_modules/eve/dist/src/harness/hitl/approval-input-requests.js";

// The 24 Nov 2026 production case: a specialist asked for five
// `update_milestone` calls in one step, eve raised one `input.requested` with
// five approvals, and the operator approved one. Nothing ran. These tests pin
// why, and what the workspace's "Approve all" / "Cancel all" rely on.

const PENDING_BATCHES_KEY = "eve.runtime.pendingInputBatches";

function batchOf(size: number) {
  const requests = Array.from({ length: size }, (_, index) => ({
    action: {
      callId: `call_${index}`,
      input: { milestoneId: `m${index}` },
      toolName: "update_milestone",
    },
    kind: "tool-approval" as const,
    options: [
      { id: "approve", label: "Approve", style: "primary" },
      { id: "cancel", label: "Cancel", style: "danger" },
    ],
    prompt: "Approve tool call: update_milestone",
    requestId: `req_${index}`,
  }));
  return {
    event: { id: "evt_input_requested", type: "input.requested" },
    requests,
    responseMessages: [],
  };
}

function resolve(
  batch: ReturnType<typeof batchOf>,
  responses: { optionId: string; requestId: string }[],
) {
  return resolveApprovalInputBatches({
    approvalBatches: [batch],
    baseHistory: [],
    batches: [batch],
    deferTurnInput: false,
    questionBatches: [],
    resolvedStepInput: undefined,
    responses,
    session: { state: { [PENDING_BATCHES_KEY]: [batch] } },
  } as never) as {
    outcome: string;
    messages: { role: string; content: Record<string, unknown>[] }[];
    rejectedActions?: { results: { callId: string }[] }[];
  };
}

function approvalParts(result: ReturnType<typeof resolve>) {
  return result.messages
    .filter((message) => message.role === "tool")
    .flatMap((message) => message.content)
    .filter((part) => part.type === "tool-approval-response");
}

describe("eve approval batches (#616)", () => {
  it("does not resume a batch, not even the approved call, while any request in it is unanswered", () => {
    const result = resolve(batchOf(5), [
      { optionId: "approve", requestId: "req_1" },
    ]);
    assert.equal(result.outcome, "unresolved");
    assert.deepEqual(approvalParts(result), []);
  });

  it("runs an approved call when every sibling is cancelled", () => {
    const result = resolve(batchOf(5), [
      { optionId: "approve", requestId: "req_1" },
      { optionId: "cancel", requestId: "req_0" },
      { optionId: "cancel", requestId: "req_2" },
      { optionId: "cancel", requestId: "req_3" },
      { optionId: "cancel", requestId: "req_4" },
    ]);
    assert.equal(result.outcome, "resolved");
    const approved = approvalParts(result)
      .filter((part) => part.approved === true)
      .map((part) => part.approvalId);
    assert.deepEqual(approved, ["req_1"]);
    const rejected = (result.rejectedActions ?? []).flatMap((batch) =>
      batch.results.map((entry) => entry.callId),
    );
    assert.deepEqual(rejected.sort(), ["call_0", "call_2", "call_3", "call_4"]);
  });

  it("runs every call when the whole batch is approved in one delivery", () => {
    const batch = batchOf(5);
    const result = resolve(
      batch,
      batch.requests.map((request) => ({
        optionId: "approve",
        requestId: request.requestId,
      })),
    );
    assert.equal(result.outcome, "resolved");
    assert.equal(
      approvalParts(result).filter((part) => part.approved === true).length,
      5,
    );
    assert.equal(result.rejectedActions, undefined);
  });
});
