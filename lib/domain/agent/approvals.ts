import { AgentActionStatus } from "@prisma/client";
import type { DomainDb } from "../db";
import { DomainAuthorizationError } from "../errors";
import type { DomainPrincipal } from "../principal";
import { approvalExpiresAt } from "./approval-expiry";

// Eve approvals that nobody answered (#617).
//
// Of the first six approval waits in production, four wrote nothing: two were
// never answered at all, one was abandoned for a retry, and one was the batch
// of #616. eve keeps a pending approval answerable for ever, so a
// `create_milestone` approved a fortnight late would run against the project
// as it is that day, and nothing on any screen said an approval was waiting.
//
// This module is the one rule for when an approval stops being answerable and
// which approvals are still waiting. The cron that expires them, the late
// approval refusal, the session list and the orchestrator's instructions all
// read it from here.

/** The audit action recorded when an approval expires unanswered. */
export const APPROVAL_EXPIRED_ACTION = "agent.approval.expired";
const APPROVAL_TARGET_TYPE = "agent-approval";

export type PendingAgentApproval = {
  readonly requestId: string;
  readonly callId: string;
  readonly toolName: string;
  /** The conversation it waits in: answering there reaches the specialist. */
  readonly rootEveSessionId: string;
  readonly ownerUserId: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  /** Every request raised in the same step, this one included. */
  readonly batchRequestIds: readonly string[];
};

type RequestedPayload = {
  data?: {
    requests?: {
      requestId?: unknown;
      kind?: unknown;
      action?: { callId?: unknown; toolName?: unknown };
    }[];
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The request ids an `input.resolved` or `approval.settled` event answers. */
function answeredIds(eventType: string, payload: unknown): string[] {
  const data = record(record(payload)?.data);
  if (!data) return [];
  if (eventType === "approval.settled") {
    return typeof data.requestId === "string" ? [data.requestId] : [];
  }
  const resolutions = Array.isArray(data.resolutions) ? data.resolutions : [];
  return resolutions.flatMap((resolution) => {
    const id = record(resolution)?.requestId;
    return typeof id === "string" ? [id] : [];
  });
}

/**
 * Tool approvals that have been asked for and not answered, oldest first.
 *
 * Read from the application's copy of eve's stream: an `input.requested` with
 * no `input.resolved` or `approval.settled` for its request, and no expiry
 * already recorded. A specialist's request is mirrored on the conversation
 * that delegated to it, so each request is counted once, against its
 * conversation.
 *
 * A signed-in caller sees their own conversations only. A system caller (the
 * expiry cron) sees all of them.
 */
export async function listPendingAgentApprovals(
  principal: DomainPrincipal,
  db: DomainDb,
  options: { readonly rootEveSessionIds?: readonly string[] } = {},
): Promise<PendingAgentApproval[]> {
  let ownerUserId: string | undefined;
  if (principal.kind === "user") ownerUserId = principal.userId;
  else if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only a signed-in user or the system may read agent approvals.",
    );
  }

  const events = await db.agentSessionEvent.findMany({
    orderBy: [{ occurredAt: "asc" }, { eveEventId: "asc" }],
    select: {
      agentSession: {
        select: { ownerUserId: true, rootEveSessionId: true },
      },
      eventType: true,
      occurredAt: true,
      payload: true,
    },
    where: {
      agentSession: {
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(options.rootEveSessionIds
          ? { rootEveSessionId: { in: [...options.rootEveSessionIds] } }
          : {}),
      },
      eventType: {
        in: ["input.requested", "input.resolved", "approval.settled"],
      },
    },
  });

  const answered = new Set<string>();
  const pending = new Map<string, PendingAgentApproval>();
  for (const event of events) {
    if (event.eventType !== "input.requested") {
      for (const id of answeredIds(event.eventType, event.payload))
        answered.add(id);
      continue;
    }
    const requests = (event.payload as RequestedPayload).data?.requests ?? [];
    const approvals = requests.filter(
      (request) =>
        request.kind === "tool-approval"
        && typeof request.requestId === "string",
    );
    const batchRequestIds = approvals.map(
      (request) => request.requestId as string,
    );
    for (const request of approvals) {
      const requestId = request.requestId as string;
      // The first sighting wins: the specialist's own copy and the forwarded
      // one carry the same request, a moment apart.
      if (pending.has(requestId)) continue;
      pending.set(requestId, {
        batchRequestIds,
        callId:
          typeof request.action?.callId === "string"
            ? request.action.callId
            : "",
        expiresAt: approvalExpiresAt(event.occurredAt),
        ownerUserId: event.agentSession.ownerUserId,
        requestId,
        requestedAt: event.occurredAt,
        rootEveSessionId: event.agentSession.rootEveSessionId,
        toolName:
          typeof request.action?.toolName === "string"
            ? request.action.toolName
            : "change",
      });
    }
  }

  const open = [...pending.values()].filter(
    (approval) => !answered.has(approval.requestId),
  );
  if (open.length === 0) return [];
  const expired = await db.agentActionAudit.findMany({
    select: { targetId: true },
    where: {
      action: APPROVAL_EXPIRED_ACTION,
      targetId: { in: open.map((approval) => approval.requestId) },
      targetType: APPROVAL_TARGET_TYPE,
    },
  });
  const recorded = new Set(expired.map((row) => row.targetId));
  return open.filter((approval) => !recorded.has(approval.requestId));
}

/**
 * Record that these approvals expired unanswered: one audit row each, under
 * the conversation's owner. Called only after eve has accepted the
 * cancellation, so a row means the change was really withdrawn. Repeating a
 * call for an approval already recorded writes nothing.
 */
export async function recordExpiredApprovals(
  principal: DomainPrincipal,
  approvals: readonly PendingAgentApproval[],
  db: DomainDb,
  now: Date = new Date(),
): Promise<number> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the system expires agent approvals.",
    );
  }
  if (approvals.length === 0) return 0;
  const already = await db.agentActionAudit.findMany({
    select: { targetId: true },
    where: {
      action: APPROVAL_EXPIRED_ACTION,
      targetId: { in: approvals.map((approval) => approval.requestId) },
      targetType: APPROVAL_TARGET_TYPE,
    },
  });
  const done = new Set(already.map((row) => row.targetId));
  const fresh = approvals.filter((approval) => !done.has(approval.requestId));
  if (fresh.length === 0) return 0;

  const sessions = await db.agentSession.findMany({
    select: { eveSessionId: true, id: true },
    where: {
      eveSessionId: {
        in: [...new Set(fresh.map((approval) => approval.rootEveSessionId))],
      },
    },
  });
  const sessionIds = new Map(sessions.map((row) => [row.eveSessionId, row.id]));

  const { count } = await db.agentActionAudit.createMany({
    data: fresh.map((approval) => ({
      action: APPROVAL_EXPIRED_ACTION,
      agentSessionId: sessionIds.get(approval.rootEveSessionId) ?? null,
      approvalOutcome: "expired",
      completedAt: now,
      eveCallId: approval.callId || null,
      eveSessionId: approval.rootEveSessionId,
      failureReason: `The approval for ${approval.toolName} was not answered by ${approval.expiresAt.toISOString()}, so the change was not made.`,
      inputSummary: {
        expiresAt: approval.expiresAt.toISOString(),
        requestedAt: approval.requestedAt.toISOString(),
        requestId: approval.requestId,
        toolName: approval.toolName,
      },
      ownerUserId: approval.ownerUserId,
      status: AgentActionStatus.REJECTED,
      targetId: approval.requestId,
      targetType: APPROVAL_TARGET_TYPE,
      toolName: approval.toolName,
    })),
  });
  return count;
}

/** Whether this request was withdrawn by the expiry rather than by a person. */
export async function wasApprovalExpired(
  requestId: string,
  db: DomainDb,
): Promise<boolean> {
  const row = await db.agentActionAudit.findFirst({
    select: { id: true },
    where: {
      action: APPROVAL_EXPIRED_ACTION,
      targetId: requestId,
      targetType: APPROVAL_TARGET_TYPE,
    },
  });
  return row !== null;
}

/**
 * When a request was asked for, or null if this copy of the stream has no
 * record of it. Used to refuse an approval given after the expiry, in the gap
 * before the cron withdraws it.
 */
export async function approvalRequestedAt(
  requestId: string,
  db: DomainDb,
): Promise<Date | null> {
  const row = await db.agentSessionEvent.findFirst({
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
    where: {
      eventType: "input.requested",
      payload: {
        array_contains: [{ requestId }],
        path: ["data", "requests"],
      },
    },
  });
  return row?.occurredAt ?? null;
}

/** Withdraws pending requests in one conversation through eve. Throws on failure. */
export type ApprovalWithdrawalPort = (
  rootEveSessionId: string,
  requests: readonly { requestId: string; toolName: string }[],
) => Promise<void>;

export type ExpireApprovalsOutcome = {
  /** Approvals withdrawn through eve and recorded as expired. */
  readonly expired: number;
  /** Conversations eve did not accept a withdrawal for; retried next run. */
  readonly failed: number;
  /** Approvals still waiting and not yet due to expire. */
  readonly waiting: number;
};

/**
 * Withdraw every approval past its expiry, a conversation at a time, and
 * record each one. A conversation eve refuses is left for the next run and
 * counted, never recorded: the audit row says the change was withdrawn, so it
 * is written only once eve has accepted the cancellation.
 *
 * A step's approvals were asked for together, so they expire together. One
 * that was already approved while its siblings waited is not withdrawn (eve
 * has saved that answer), and runs when the rest are cancelled; that is the
 * person's decision, and `update_milestones` makes such batches rare.
 */
export async function expireStaleApprovals(
  principal: DomainPrincipal,
  input: { readonly now?: Date },
  db: DomainDb,
  ports: { readonly withdraw: ApprovalWithdrawalPort },
): Promise<ExpireApprovalsOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the system expires agent approvals.",
    );
  }
  const now = input.now ?? new Date();
  const pending = await listPendingAgentApprovals(principal, db);
  const due = pending.filter(
    (approval) => approval.expiresAt.getTime() < now.getTime(),
  );
  const byConversation = new Map<string, PendingAgentApproval[]>();
  for (const approval of due) {
    const list = byConversation.get(approval.rootEveSessionId) ?? [];
    list.push(approval);
    byConversation.set(approval.rootEveSessionId, list);
  }

  let expired = 0;
  let failed = 0;
  for (const [rootEveSessionId, approvals] of byConversation) {
    try {
      await ports.withdraw(rootEveSessionId, approvals);
    } catch (error) {
      failed += 1;
      console.error(
        `[approval-expiry] eve did not accept the withdrawal for session ${rootEveSessionId}`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    expired += await recordExpiredApprovals(principal, approvals, db, now);
  }
  return { expired, failed, waiting: pending.length - due.length };
}
