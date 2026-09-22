import { defaultMessageReducer } from "eve/react";
import type {
  EveAgentReducer,
  EveAgentReducerEvent,
  EveMessage,
} from "eve/react";
import type { SubagentChildEventStreamEvent } from "eve/client";

/** A child stream event, which arrives without the durable `meta` envelope. */
type AgentChildStreamEvent = SubagentChildEventStreamEvent["data"]["event"];

/**
 * Transcript projection for the operations workspace.
 *
 * Everything the workspace renders is derived here from the durable Eve event
 * stream, never from React state fed by `onEvent`. A replayed session — a
 * reload, a `resume()`, or server-hydrated `initialEvents` — therefore rebuilds
 * the same delegation, approval and budget view it had before, instead of
 * showing an empty shell while the stream catches up.
 */
export type AgentTranscriptData = {
  messages: readonly EveMessage[];
  turns: readonly AgentTurn[];
  subagents: readonly AgentSubagentRun[];
  labels: Readonly<Record<string, string>>;
  pendingApprovals: readonly AgentPendingApproval[];
  usage: AgentSessionUsage;
  compaction: AgentCompaction | null;
};

export type AgentTurnStatus = "running" | "completed" | "cancelled" | "failed";

export type AgentTurn = {
  turnId: string;
  sequence: number;
  status: AgentTurnStatus;
  startedAt: string | null;
  endedAt: string | null;
  failure: { code: string; message: string } | null;
  steps: readonly AgentStep[];
};

export type AgentStep = {
  stepIndex: number;
  modelId: string | null;
  status: "running" | "completed" | "failed";
  startedAt: string | null;
  endedAt: string | null;
  usage: AgentStepUsage | null;
  failure: { code: string; message: string } | null;
};

export type AgentStepUsage = {
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type AgentSessionUsage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  steps: number;
};

/**
 * `interrupted` is not a child failure. It marks a delegation whose parent turn
 * ended without the child ever reporting, so the panel stops spinning forever
 * instead of implying work is still in flight.
 */
export type AgentSubagentStatus =
  | "requested"
  | "delegating"
  | "working"
  | "completed"
  | "failed"
  | "interrupted";

export type AgentSubagentRun = {
  callId: string;
  turnId: string | null;
  name: string;
  toolName: string | null;
  childSessionId: string | null;
  status: AgentSubagentStatus;
  startedAt: string | null;
  endedAt: string | null;
  output: string | null;
  error: string | null;
  taskId: string | null;
  remote: boolean;
  progress: string | null;
};

export type AgentPendingApproval = {
  requestId: string;
  turnId: string;
  callId: string;
  toolName: string;
  kind: "question" | "session-limit" | "tool-approval";
  prompt: string;
  messageId: string;
  requestedAt: string | null;
};

export type AgentCompaction = {
  status: "requested" | "completed";
  at: string | null;
};

const emptyUsage: AgentSessionUsage = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  steps: 0,
};

export const emptyTranscriptData: AgentTranscriptData = {
  compaction: null,
  labels: {},
  messages: [],
  pendingApprovals: [],
  subagents: [],
  turns: [],
  usage: emptyUsage,
};

/**
 * Wraps `defaultMessageReducer` so `data.messages` keeps Eve's own projection
 * and stays compatible with the AI Elements rendering convention, then adds the
 * operations-desk projections alongside it.
 */
export function agentTranscriptReducer(): EveAgentReducer<AgentTranscriptData> {
  const messageReducer = defaultMessageReducer();
  return {
    initial: () => ({
      ...emptyTranscriptData,
      messages: messageReducer.initial().messages,
    }),
    reduce: (data, event) => {
      const { messages } = messageReducer.reduce(
        { messages: data.messages },
        event,
      );
      const next = reduceTranscript(data, event);
      if (messages === data.messages) return next;
      return { ...next, messages };
    },
  };
}

function reduceTranscript(
  data: AgentTranscriptData,
  event: EveAgentReducerEvent,
): AgentTranscriptData {
  const at = "meta" in event ? event.meta.at : null;
  switch (event.type) {
    case "turn.started":
      return {
        ...data,
        turns: upsertTurn(data.turns, event.data.turnId, (turn) => ({
          ...turn,
          sequence: event.data.sequence,
          startedAt: turn.startedAt ?? at,
        })),
      };
    case "turn.completed":
      return settleTurn(data, event.data.turnId, "completed", at, null);
    case "turn.cancelled":
      return settleTurn(data, event.data.turnId, "cancelled", at, null);
    case "turn.failed":
      return settleTurn(data, event.data.turnId, "failed", at, {
        code: event.data.code,
        message: event.data.message,
      });
    case "step.started":
      return {
        ...data,
        turns: upsertStep(
          data.turns,
          event.data.turnId,
          event.data.stepIndex,
          (step) => ({
            ...step,
            modelId: event.data.modelId,
            startedAt: step.startedAt ?? at,
          }),
        ),
      };
    case "step.completed": {
      const usage = event.data.usage ?? null;
      return {
        ...data,
        turns: upsertStep(
          data.turns,
          event.data.turnId,
          event.data.stepIndex,
          (step) => ({
            ...step,
            endedAt: at,
            status: "completed",
            usage: usage
              ? {
                  costUsd: usage.costUsd ?? null,
                  inputTokens: usage.inputTokens ?? null,
                  outputTokens: usage.outputTokens ?? null,
                }
              : step.usage,
          }),
        ),
        usage: {
          costUsd: data.usage.costUsd + (usage?.costUsd ?? 0),
          inputTokens: data.usage.inputTokens + (usage?.inputTokens ?? 0),
          outputTokens: data.usage.outputTokens + (usage?.outputTokens ?? 0),
          steps: data.usage.steps + 1,
        },
      };
    }
    case "step.failed":
      return {
        ...data,
        turns: upsertStep(
          data.turns,
          event.data.turnId,
          event.data.stepIndex,
          (step) => ({
            ...step,
            endedAt: at,
            failure: { code: event.data.code, message: event.data.message },
            status: "failed",
          }),
        ),
      };
    case "actions.requested": {
      let next = withLabels(data, event.data.presentation);
      for (const action of event.data.actions) {
        if (
          action.kind !== "subagent-call"
          && action.kind !== "remote-agent-call"
        )
          continue;
        next = {
          ...next,
          subagents: upsertSubagent(next.subagents, action.callId, (run) => ({
            ...run,
            name: run.name || action.name,
            remote: action.kind === "remote-agent-call" || run.remote,
            startedAt: run.startedAt ?? at,
            turnId: event.data.turnId,
          })),
        };
      }
      return next;
    }
    case "subagent.called":
      return {
        ...data,
        subagents: upsertSubagent(data.subagents, event.data.callId, (run) => ({
          ...run,
          childSessionId: event.data.childSessionId,
          name: run.name || event.data.name,
          // `actions.requested` may already have classified this call from its
          // `remote-agent-call` kind. This event omits `remote` for a local
          // child, so it must not be allowed to clear that.
          remote: event.data.remote !== undefined || run.remote,
          startedAt: run.startedAt ?? at,
          status: isTerminalSubagent(run.status) ? run.status : "delegating",
          toolName: event.data.toolName,
          turnId: run.turnId ?? event.data.turnId,
        })),
      };
    case "subagent.started":
      return {
        ...data,
        subagents: upsertSubagent(data.subagents, event.data.callId, (run) => ({
          ...run,
          name: run.name || event.data.subagentName,
          status: isTerminalSubagent(run.status) ? run.status : "working",
        })),
      };
    case "subagent.completed": {
      const backgroundTask = event.data.backgroundTask;
      return {
        ...data,
        subagents: upsertSubagent(data.subagents, event.data.callId, (run) => ({
          ...run,
          endedAt: backgroundTask ? run.endedAt : at,
          name: run.name || event.data.subagentName,
          output: backgroundTask ? run.output : event.data.output,
          status: backgroundTask ? "working" : "completed",
          taskId: backgroundTask?.taskId ?? run.taskId,
        })),
      };
    }
    case "subagent.event":
      return withChildProgress(data, event.data.callId, event.data.event);
    case "input.requested": {
      const added = event.data.requests.map((request) => ({
        callId: request.action.callId,
        kind: request.kind,
        messageId: `${event.data.turnId}:assistant`,
        prompt: request.prompt,
        requestedAt: at,
        requestId: request.requestId,
        toolName: request.action.toolName,
        turnId: event.data.turnId,
      }));
      return {
        ...data,
        pendingApprovals: [
          ...data.pendingApprovals.filter(
            (pending) =>
              !added.some((item) => item.requestId === pending.requestId),
          ),
          ...added,
        ],
      };
    }
    case "input.resolved":
      return clearApprovals(
        data,
        event.data.resolutions.map((resolution) => resolution.requestId),
      );
    case "client.input.responded":
      return clearApprovals(
        data,
        event.data.responses.map((response) => response.requestId),
      );
    case "approval.settled":
      return clearApprovals(data, [event.data.requestId]);
    case "action.result": {
      const next = withLabels(data, event.data.presentation);
      const result = event.data.result;
      if (result.kind !== "subagent-result") return next;
      const backgroundTask =
        "backgroundTask" in result ? result.backgroundTask : undefined;
      return {
        ...next,
        subagents: upsertSubagent(next.subagents, result.callId, (run) => ({
          ...run,
          endedAt: backgroundTask ? run.endedAt : at,
          error: result.isError
            ? (event.data.error?.message ?? stringify(result.output))
            : run.error,
          name: run.name || result.subagentName,
          output:
            backgroundTask || result.isError
              ? run.output
              : stringify(result.output),
          status: backgroundTask
            ? "working"
            : result.isError
              ? "failed"
              : "completed",
          taskId: backgroundTask?.taskId ?? run.taskId,
        })),
      };
    }
    case "action.partial":
      return withLabels(data, event.data.presentation);
    case "compaction.requested":
      return { ...data, compaction: { at, status: "requested" } };
    case "compaction.completed":
      return { ...data, compaction: { at, status: "completed" } };
    default:
      return data;
  }
}

function withChildProgress(
  data: AgentTranscriptData,
  callId: string,
  event: AgentChildStreamEvent,
): AgentTranscriptData {
  const progress = childProgressLabel(event);
  if (progress === null) return data;
  return {
    ...data,
    subagents: upsertSubagent(data.subagents, callId, (run) => ({
      ...run,
      progress,
    })),
  };
}

/** One short line describing what a delegated specialist is doing right now. */
export function childProgressLabel(
  event: AgentChildStreamEvent | EveAgentReducerEvent,
): string | null {
  switch (event.type) {
    case "message.completed":
      return event.data.message?.trim() || null;
    case "message.appended":
      return event.data.messageDelta.trim() || null;
    case "actions.requested": {
      const names = event.data.actions
        .map((action) =>
          action.kind === "tool-call" || action.kind === "workflow-tool-call"
            ? action.toolName
            : action.kind === "subagent-call"
                || action.kind === "remote-agent-call"
              ? action.name
              : action.kind,
        )
        .filter(Boolean)
        .join(", ");
      return names ? `Running ${names}` : null;
    }
    case "action.input.appended":
      return `Preparing ${event.data.toolName}`;
    case "action.result":
      return event.data.status === "failed"
        ? "A specialist action failed"
        : "Action completed";
    case "session.completed":
      return "Specialist session completed";
    case "session.failed":
      return "Specialist session failed";
    default:
      return null;
  }
}

function clearApprovals(
  data: AgentTranscriptData,
  requestIds: readonly string[],
): AgentTranscriptData {
  const remaining = data.pendingApprovals.filter(
    (pending) => !requestIds.includes(pending.requestId),
  );
  return remaining.length === data.pendingApprovals.length
    ? data
    : { ...data, pendingApprovals: remaining };
}

function withLabels(
  data: AgentTranscriptData,
  presentation:
    | Readonly<Record<string, { readonly label?: string }>>
    | undefined,
): AgentTranscriptData {
  if (!presentation) return data;
  let labels = data.labels;
  for (const [callId, value] of Object.entries(presentation)) {
    if (!value?.label || labels[callId] === value.label) continue;
    if (labels === data.labels) labels = { ...labels };
    labels = { ...labels, [callId]: value.label };
  }
  return labels === data.labels ? data : { ...data, labels };
}

function settleTurn(
  data: AgentTranscriptData,
  turnId: string,
  status: AgentTurnStatus,
  at: string | null,
  failure: { code: string; message: string } | null,
): AgentTranscriptData {
  return {
    ...data,
    subagents: data.subagents.map((run) =>
      run.turnId === turnId
      && !isTerminalSubagent(run.status)
      && run.taskId === null
        ? { ...run, endedAt: run.endedAt ?? at, status: "interrupted" as const }
        : run,
    ),
    turns: upsertTurn(data.turns, turnId, (turn) => ({
      ...turn,
      endedAt: at,
      failure: failure ?? turn.failure,
      status,
      steps: turn.steps.map((step) =>
        step.status === "running"
          ? { ...step, endedAt: step.endedAt ?? at }
          : step,
      ),
    })),
  };
}

function isTerminalSubagent(status: AgentSubagentStatus) {
  return (
    status === "completed" || status === "failed" || status === "interrupted"
  );
}

function upsertTurn(
  turns: readonly AgentTurn[],
  turnId: string,
  update: (turn: AgentTurn) => AgentTurn,
): readonly AgentTurn[] {
  const index = turns.findIndex((turn) => turn.turnId === turnId);
  if (index === -1) {
    return [
      ...turns,
      update({
        endedAt: null,
        failure: null,
        sequence: turns.length,
        startedAt: null,
        status: "running",
        steps: [],
        turnId,
      }),
    ];
  }
  const current = turns[index] as AgentTurn;
  const next = update(current);
  return next === current
    ? turns
    : [...turns.slice(0, index), next, ...turns.slice(index + 1)];
}

function upsertStep(
  turns: readonly AgentTurn[],
  turnId: string,
  stepIndex: number,
  update: (step: AgentStep) => AgentStep,
): readonly AgentTurn[] {
  return upsertTurn(turns, turnId, (turn) => {
    const index = turn.steps.findIndex((step) => step.stepIndex === stepIndex);
    if (index === -1) {
      return {
        ...turn,
        steps: [
          ...turn.steps,
          update({
            endedAt: null,
            failure: null,
            modelId: null,
            startedAt: null,
            status: "running",
            stepIndex,
            usage: null,
          }),
        ].sort((left, right) => left.stepIndex - right.stepIndex),
      };
    }
    const current = turn.steps[index] as AgentStep;
    return {
      ...turn,
      steps: [
        ...turn.steps.slice(0, index),
        update(current),
        ...turn.steps.slice(index + 1),
      ],
    };
  });
}

function upsertSubagent(
  runs: readonly AgentSubagentRun[],
  callId: string,
  update: (run: AgentSubagentRun) => AgentSubagentRun,
): readonly AgentSubagentRun[] {
  const index = runs.findIndex((run) => run.callId === callId);
  if (index === -1) {
    return [
      ...runs,
      update({
        callId,
        childSessionId: null,
        endedAt: null,
        error: null,
        name: "",
        output: null,
        progress: null,
        remote: false,
        startedAt: null,
        status: "requested",
        taskId: null,
        toolName: null,
        turnId: null,
      }),
    ];
  }
  const current = runs[index] as AgentSubagentRun;
  const next = update(current);
  return next === current
    ? runs
    : [...runs.slice(0, index), next, ...runs.slice(index + 1)];
}

function stringify(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
