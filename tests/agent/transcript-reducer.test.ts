import assert from "node:assert/strict";
import { test } from "vitest";

import {
  agentTranscriptReducer,
  type AgentTranscriptData,
} from "@/components/agent/agent-reducer";

let eventSequence = 0;

/** Stamps an event the way Eve stamps it before writing it to the durable stream. */
function stamped<TEvent extends { type: string; data?: unknown }>(
  event: TEvent,
  at = "2026-09-22T01:00:00.000Z",
) {
  eventSequence += 1;
  return {
    ...event,
    meta: { at, id: `evt_${eventSequence}` },
  } as never;
}

function reduceAll(events: readonly unknown[]): AgentTranscriptData {
  const reducer = agentTranscriptReducer();
  return events.reduce<AgentTranscriptData>(
    (data, event) => reducer.reduce(data, event as never),
    reducer.initial(),
  );
}

const turnId = "turn_1";

const delegationEvents = [
  stamped({ data: { sequence: 0, turnId }, type: "turn.started" }),
  stamped({
    data: { modelId: "zai/glm-5.3-flash", sequence: 1, stepIndex: 0, turnId },
    type: "step.started",
  }),
  stamped({
    data: {
      actions: [
        {
          callId: "call_1",
          description: "Offer specialist",
          input: {},
          kind: "subagent-call",
          name: "offer-operations",
          nodeId: "node_1",
          subagentName: "offer-operations",
        },
      ],
      presentation: { call_1: { label: "Check the offer history" } },
      sequence: 2,
      stepIndex: 0,
      turnId,
    },
    type: "actions.requested",
  }),
  stamped({
    data: {
      callId: "call_1",
      childSessionId: "wrun_child",
      childStreamPath: "/stream",
      name: "offer-operations",
      sequence: 3,
      sessionId: "wrun_root",
      toolName: "offer_operations",
      turnId,
      workflowId: "wf_1",
    },
    type: "subagent.called",
  }),
  stamped({
    data: { callId: "call_1", subagentName: "offer-operations" },
    type: "subagent.started",
  }),
];

test("a delegation projects its authored label and live status", () => {
  const data = reduceAll(delegationEvents);

  assert.equal(data.subagents.length, 1);
  assert.equal(data.subagents[0]?.status, "working");
  assert.equal(data.subagents[0]?.childSessionId, "wrun_child");
  assert.equal(data.labels.call_1, "Check the offer history");
});

test("delegation state survives a full replay of the same stream", () => {
  const live = reduceAll(delegationEvents);
  const replayed = reduceAll(delegationEvents);

  assert.deepEqual(replayed.subagents, live.subagents);
  assert.deepEqual(replayed.labels, live.labels);
});

test("a remote classification is not cleared by the delegation event", () => {
  // `actions.requested` classifies from the action kind; `subagent.called`
  // omits `remote` for a local child and must not overwrite that verdict.
  const data = reduceAll([
    stamped({ data: { sequence: 0, turnId }, type: "turn.started" }),
    stamped({
      data: {
        actions: [
          {
            callId: "call_r",
            description: "Remote specialist",
            input: {},
            kind: "remote-agent-call",
            name: "remote-ops",
            nodeId: "node_r",
            remoteAgentName: "remote-ops",
          },
        ],
        sequence: 1,
        stepIndex: 0,
        turnId,
      },
      type: "actions.requested",
    }),
    stamped({
      data: {
        callId: "call_r",
        childSessionId: "wrun_remote",
        childStreamPath: "/stream",
        name: "remote-ops",
        sequence: 2,
        sessionId: "wrun_root",
        toolName: "remote_ops",
        turnId,
        workflowId: "wf_r",
      },
      type: "subagent.called",
    }),
  ]);

  assert.equal(data.subagents[0]?.remote, true);
});

test("a local delegation stays local", () => {
  const data = reduceAll(delegationEvents);

  assert.equal(data.subagents[0]?.remote, false);
});

test("a background-task receipt keeps the specialist running", () => {
  const data = reduceAll([
    ...delegationEvents,
    stamped({
      data: {
        backgroundTask: { status: "working", taskId: "task_1" },
        callId: "call_1",
        output: "Started in the background.",
        subagentName: "offer-operations",
      },
      type: "subagent.completed",
    }),
  ]);

  assert.equal(data.subagents[0]?.status, "working");
  assert.equal(data.subagents[0]?.taskId, "task_1");
});

test("a turn that ends without a child result stops the spinner", () => {
  const data = reduceAll([
    ...delegationEvents,
    stamped({ data: { sequence: 9, turnId }, type: "turn.completed" }),
  ]);

  assert.equal(data.subagents[0]?.status, "interrupted");
  assert.equal(data.turns[0]?.status, "completed");
});

test("a cancelled turn is not reported as a failure", () => {
  const data = reduceAll([
    stamped({ data: { sequence: 0, turnId }, type: "turn.started" }),
    stamped({ data: { sequence: 1, turnId }, type: "turn.cancelled" }),
  ]);

  assert.equal(data.turns[0]?.status, "cancelled");
  assert.equal(data.turns[0]?.failure, null);
});

const approvalRequest = stamped({
  data: {
    requests: [
      {
        action: {
          callId: "call_2",
          input: { party: "BUILDER" },
          kind: "tool-call",
          toolName: "send_compliance_outreach",
        },
        kind: "tool-approval",
        options: [
          { id: "approve", label: "Approve" },
          { id: "deny", label: "Decline", style: "danger" },
        ],
        prompt: "Send builder outreach?",
        requestId: "req_1",
      },
    ],
    sequence: 4,
    stepIndex: 0,
    turnId,
  },
  type: "input.requested",
});

test("a pending approval is projected until the server resolves it", () => {
  const pending = reduceAll([approvalRequest]);
  assert.equal(pending.pendingApprovals.length, 1);
  assert.equal(
    pending.pendingApprovals[0]?.toolName,
    "send_compliance_outreach",
  );
  assert.equal(pending.pendingApprovals[0]?.messageId, `${turnId}:assistant`);

  const resolved = reduceAll([
    approvalRequest,
    stamped({
      data: {
        resolutions: [
          {
            kind: "tool-approval",
            outcome: "approved",
            requestId: "req_1",
            response: { optionId: "approve", requestId: "req_1" },
          },
        ],
        sequence: 5,
        stepIndex: 0,
        turnId,
      },
      type: "input.resolved",
    }),
  ]);
  assert.deepEqual(resolved.pendingApprovals, []);
});

test("a locally submitted response clears the approval before the server confirms", () => {
  const data = reduceAll([
    approvalRequest,
    {
      data: {
        createdAt: 0,
        responses: [{ optionId: "approve", requestId: "req_1" }],
      },
      type: "client.input.responded",
    },
  ]);

  assert.deepEqual(data.pendingApprovals, []);
});

test("session usage accumulates across steps so the budget can be shown", () => {
  const data = reduceAll([
    stamped({ data: { sequence: 0, turnId }, type: "turn.started" }),
    stamped({
      data: {
        finishReason: "tool-calls",
        sequence: 1,
        stepIndex: 0,
        turnId,
        usage: { costUsd: 0.02, inputTokens: 1_200, outputTokens: 80 },
      },
      type: "step.completed",
    }),
    stamped({
      data: {
        finishReason: "stop",
        sequence: 2,
        stepIndex: 1,
        turnId,
        usage: { costUsd: 0.03, inputTokens: 900, outputTokens: 140 },
      },
      type: "step.completed",
    }),
  ]);

  assert.equal(data.usage.steps, 2);
  assert.equal(Number(data.usage.costUsd.toFixed(4)), 0.05);
  assert.equal(data.usage.inputTokens, 2_100);
  assert.equal(data.usage.outputTokens, 220);
});

test("the user message is projected and never hidden by a running delegation", () => {
  const data = reduceAll([
    ...delegationEvents,
    stamped({
      data: {
        message: "Find the latest offer for the Smiths.",
        sequence: 6,
        turnId,
      },
      type: "message.received",
    }),
  ]);

  const user = data.messages.find((message) => message.role === "user");
  // eve >= 0.61 ids a user message by its delivery event; the turn it belongs
  // to — what annotations are keyed by — rides on the metadata.
  assert.equal(user?.metadata?.turnId, turnId);
  assert.equal(data.subagents[0]?.status, "working");
});

/**
 * The orchestrator reaches specialists through the blocking `delegate`
 * workflow tool, whose child reports on the parent stream as `subagent.called`
 * then `subagent.completed` with no background receipt.
 */
const blockingDelegation = [
  stamped({ data: { sequence: 0, turnId }, type: "turn.started" }),
  stamped({
    data: {
      actions: [
        {
          callId: "call_delegate",
          input: {
            request: "Find the Smith lead",
            specialist: "lead-operations",
          },
          kind: "tool-call",
          toolName: "delegate",
        },
      ],
      sequence: 1,
      stepIndex: 0,
      turnId,
    },
    type: "actions.requested",
  }),
  stamped({
    data: {
      agentId: "ag_lead",
      callId: "call_delegate:inv_1",
      childSessionId: "wrun_child_lead",
      childStreamPath: "/eve/v1/session/wrun_child_lead/stream",
      name: "lead-operations",
      sequence: 0,
      sessionId: "wrun_parent",
      toolName: "lead-operations",
      turnId,
      workflowId: "workflow//eve//workflowEntry",
    },
    type: "subagent.called",
  }),
];

const leadEnvelope = {
  kind: "entity-summary",
  summary: "Stage: quoting. Last contact 2 days ago.",
  title: "Smith — 12 Example St",
  version: 1,
};

test("a blocking delegation is live until the specialist answers, then shows its answer as prose", () => {
  const running = reduceAll(blockingDelegation);
  assert.equal(running.subagents.length, 1);
  assert.equal(running.subagents[0]?.status, "delegating");
  assert.equal(running.subagents[0]?.childSessionId, "wrun_child_lead");

  const done = reduceAll([
    ...blockingDelegation,
    stamped({
      data: {
        callId: "call_delegate:inv_1",
        output: JSON.stringify(leadEnvelope),
        subagentName: "lead-operations",
      },
      type: "subagent.completed",
    }),
    stamped({ data: { sequence: 9, turnId }, type: "turn.completed" }),
  ]);

  assert.equal(done.subagents[0]?.status, "completed");
  assert.equal(
    done.subagents[0]?.output,
    "Smith — 12 Example St — Stage: quoting. Last contact 2 days ago.",
  );
});

test("a legacy task wake-up settles its specialist and is never a chat bubble", () => {
  const data = reduceAll([
    ...delegationEvents,
    stamped({
      data: {
        backgroundTask: { status: "working", taskId: "task_1" },
        callId: "call_1",
        output: "Started in the background.",
        subagentName: "offer-operations",
      },
      type: "subagent.completed",
    }),
    stamped({ data: { sequence: 9, turnId }, type: "turn.completed" }),
    stamped({
      data: {
        message: `Background task task_1 (offer-operations) is completed.\n\nResult:\n${JSON.stringify(leadEnvelope)}`,
        sequence: 0,
        turnId: "turn_2",
      },
      type: "message.received",
    }),
  ]);

  assert.equal(
    data.messages.some((message) => message.role === "user"),
    false,
    "the runtime-authored wake-up is not rendered as something the operator sent",
  );
  assert.equal(data.subagents[0]?.status, "completed");
  assert.equal(
    data.subagents[0]?.output,
    "Smith — 12 Example St — Stage: quoting. Last contact 2 days ago.",
  );
});

test("a legacy task failure marks the specialist failed with its error", () => {
  const data = reduceAll([
    ...delegationEvents,
    stamped({
      data: {
        backgroundTask: { status: "working", taskId: "task_1" },
        callId: "call_1",
        output: "Started in the background.",
        subagentName: "offer-operations",
      },
      type: "subagent.completed",
    }),
    stamped({
      data: {
        message:
          "Background task task_1 (offer-operations) failed.\n\nError:\nSESSION_TOKEN_LIMIT_REACHED",
        sequence: 0,
        turnId: "turn_2",
      },
      type: "message.received",
    }),
  ]);

  assert.equal(data.subagents[0]?.status, "failed");
  assert.equal(data.subagents[0]?.error, "SESSION_TOKEN_LIMIT_REACHED");
});

test("a marked background-task wake-up is not rendered as a user message", () => {
  const data = reduceAll([
    stamped({
      data: {
        kind: "execution.background_task",
        message: "Background task reporting: launch acknowledgement",
        sequence: 0,
        turnId,
      },
      type: "message.received",
    }),
  ]);

  assert.deepEqual(
    data.messages.filter((message) => message.role === "user"),
    [],
  );
});

test("an operator message that merely mentions a background task is still shown", () => {
  const data = reduceAll([
    stamped({
      data: {
        message: "Why did the background task for the Smiths stop?",
        sequence: 0,
        turnId,
      },
      type: "message.received",
    }),
  ]);

  assert.equal(
    data.messages.filter((message) => message.role === "user").length,
    1,
  );
});

test("a specialist waiting on an owner approval is not reported as silent", () => {
  const data = reduceAll([
    ...blockingDelegation,
    stamped({
      data: {
        requests: [
          {
            action: {
              callId: "call_task",
              input: { note: "Call back Friday" },
              kind: "tool-call",
              toolName: "create_lead_task",
            },
            kind: "tool-approval",
            options: [
              { id: "approve", label: "Approve" },
              { id: "cancel", label: "Cancel" },
            ],
            prompt: "Approve tool call: create_lead_task",
            requestId: "req_task",
          },
        ],
        sequence: 2,
        stepIndex: 0,
        turnId,
      },
      type: "input.requested",
    }),
    stamped({ data: { sequence: 3, turnId }, type: "turn.completed" }),
  ]);

  assert.equal(data.pendingApprovals.length, 1);
  assert.equal(data.subagents[0]?.status, "delegating");
});

test("a specialist that fails is shown as failed, not left working", () => {
  const data = reduceAll([
    ...blockingDelegation,
    stamped({
      data: {
        error: { message: "Failed after 3 attempts." },
        result: {
          callId: "call_delegate",
          kind: "tool-result",
          output: { code: "SUBAGENT_EXECUTION_FAILED" },
          toolName: "delegate",
        },
        sequence: 4,
        status: "failed",
        stepIndex: 0,
        turnId,
      },
      type: "action.result",
    }),
  ]);

  assert.equal(data.subagents[0]?.status, "failed");
  assert.equal(data.subagents[0]?.error, "Failed after 3 attempts.");
});

test("a step without a provider cost is priced at the model's list price", () => {
  const data = reduceAll([
    stamped({ data: { sequence: 0, turnId }, type: "turn.started" }),
    stamped({
      data: {
        finishReason: "stop",
        sequence: 1,
        stepIndex: 0,
        turnId,
        usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
      },
      type: "step.completed",
    }),
  ]);

  // $0.08 per million input + $0.25 per million output.
  assert.equal(Number(data.usage.costUsd.toFixed(4)), 0.105);
});
