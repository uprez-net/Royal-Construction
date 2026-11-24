import type {
  ApprovalResponseDecision,
  ApprovalResponsePolicy,
} from "eve/tools/approval";
import { always } from "eve/tools/approval";
import { formatSydneyDate } from "@/lib/dates/sydney";
import {
  approvalExpiresAt,
  isApprovalExpired,
} from "@/lib/domain/agent/approval-expiry";
import { approvalRequestedAt } from "@/lib/domain/agent/approvals";
import { agentDb } from "@/agent/lib/db";

type RequestTime = (requestId: string) => Promise<Date | null>;

/**
 * Refuses an approval given after its expiry (#617), in the window before the
 * expiry cron withdraws it. "Rejected" leaves the request pending; the cron
 * then cancels it and the turn ends with "Not done".
 *
 * A failed lookup refuses too: an approval nobody could check is not let
 * through. The refusal leaves the request pending, so the owner can press
 * Approve again once the database answers.
 */
async function expiredRefusal(
  requestId: string,
  requestTime: RequestTime,
  now: Date,
): Promise<ApprovalResponseDecision | null> {
  let requestedAt: Date | null;
  try {
    requestedAt = await requestTime(requestId);
  } catch (error) {
    console.error(
      `[agent-approval] could not read when request ${requestId} was made`,
      error instanceof Error ? error.message : error,
    );
    return {
      status: "rejected",
      reason:
        "Could not check whether this approval is still current, so the change was not made yet. Try approving again in a moment.",
    };
  }
  if (!requestedAt || !isApprovalExpired(requestedAt, now)) return null;
  return {
    status: "rejected",
    reason: `This approval expired at the end of ${formatSydneyDate(approvalExpiresAt(requestedAt))}, so the change was not made. Ask the agent again if it is still wanted.`,
  };
}

export function ownerMayApprove(
  requestTime: RequestTime,
  now: () => Date = () => new Date(),
): ApprovalResponsePolicy {
  return async ({ request, responder, session }) => {
    const owner = session.initiator;
    const isOwner =
      owner?.principalType === "user"
      && responder.principalType === "user"
      && typeof owner.principalId === "string"
      && owner.principalId.length > 0
      && typeof responder.principalId === "string"
      && responder.principalId.length > 0
      && responder.principalId === owner.principalId;
    if (!isOwner) {
      return {
        status: "rejected",
        reason: "Only the owner of this agent session can approve the action.",
      };
    }
    const requestId = request?.requestId;
    if (!requestId) return { status: "allowed" };
    return (
      (await expiredRefusal(requestId, requestTime, now())) ?? {
        status: "allowed",
      }
    );
  };
}

/** Require a fresh approval whose responder is the permanent session owner. */
export function ownerOnlyApproval() {
  return {
    request: always(),
    response: ownerMayApprove((requestId) =>
      approvalRequestedAt(requestId, agentDb),
    ),
  };
}
