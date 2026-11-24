import { defineDynamic, defineInstructions } from "eve/instructions";
import { agentDb } from "@/agent/lib/db";
import { formatSydneyDate, formatSydneyDateTime } from "@/lib/dates/sydney";
import {
  listPendingAgentApprovals,
  type PendingAgentApproval,
} from "@/lib/domain/agent/approvals";
import { findUserById } from "@/lib/domain/identity/users";
import { userPrincipal } from "@/lib/domain/principal";

/**
 * Approvals the caller has not answered, in any of their conversations (#617).
 *
 * An unanswered approval used to be visible only in the transcript it was
 * raised in: the morning brief never said "an approval from Tuesday is still
 * waiting", and the office took a change for made that never was. Resolved
 * every turn from the live record, so a brief always mentions it.
 *
 * Sorts after the office snapshot and before the clock (instruction files
 * compose in filename order), so the cached prefix is only broken when the
 * list of waiting approvals itself changes.
 */
export function pendingApprovalsText(
  approvals: readonly PendingAgentApproval[],
  currentSessionId: string,
): string | null {
  const elsewhere = approvals.filter(
    (approval) => approval.rootEveSessionId !== currentSessionId,
  );
  if (elsewhere.length === 0) return null;
  const lines = elsewhere
    .slice(0, 10)
    .map(
      (approval) =>
        `- ${approval.toolName}, asked ${formatSydneyDateTime(approval.requestedAt)}; expires at the end of ${formatSydneyDate(approval.expiresAt)}`,
    );
  const more = elsewhere.length - lines.length;
  return [
    "## Approvals still waiting in other conversations",
    "These changes were asked for and nobody has approved or cancelled them, so none of them has been made. Mention them in any brief or overview, and never describe them as done. They are answered on their cards in the conversation where they were raised; an approval that expires is withdrawn and the change is not made.",
    ...lines,
    ...(more > 0 ? [`- and ${more} more`] : []),
  ].join("\n");
}

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      try {
        const caller = ctx.session.auth.current;
        if (caller?.principalType !== "user" || !caller.principalId)
          return null;
        const user = await findUserById(caller.principalId, agentDb);
        if (!user) return null;
        const approvals = await listPendingAgentApprovals(
          userPrincipal(user),
          agentDb,
        );
        const content = pendingApprovalsText(approvals, ctx.session.id);
        return content ? defineInstructions({ content }) : null;
      } catch (error) {
        // Contributes nothing rather than failing the turn.
        console.error(
          "[pending-approvals] could not list waiting approvals",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },
  },
});
