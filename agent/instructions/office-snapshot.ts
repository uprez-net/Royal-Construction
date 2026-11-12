import { defineDynamic, defineInstructions } from "eve/instructions";
import { agentDb } from "@/agent/lib/db";
import { formatSydneyDateTime } from "@/lib/dates/sydney";
import { readOfficeDigest } from "@/lib/domain/agent-context";
import { DomainAuthorizationError } from "@/lib/domain/errors";
import { findUserById } from "@/lib/domain/identity/users";
import { userPrincipal } from "@/lib/domain/principal";

/**
 * Where the whole business stands, in the orchestrator's context: leads by
 * stage, offers out for signature, overdue tasks, this week's meetings, jobs
 * in progress, compliance alerts and money owed.
 *
 * Administrators only, because it is every client's money. Resolved on every
 * turn, not once per session: a session lives for up to seven days, and a
 * caller who stops being an administrator must stop seeing the digest on
 * their next message rather than keep it for the life of the session. A
 * turn-scoped system instruction is replaced each turn, so a refusal removes
 * it. The text only changes when the nightly refresh does, so the prompt
 * prefix stays stable between refreshes.
 *
 * A missing digest, a refusal or a failed read contributes nothing rather
 * than failing the turn — the agent can still look everything up.
 */
export async function officeSnapshotInstructions(ctx: {
  session: {
    auth: { current?: { principalType?: string; principalId?: string } | null };
  };
}): Promise<string | null> {
  try {
    const caller = ctx.session.auth.current;
    if (caller?.principalType !== "user" || !caller.principalId) return null;
    // The same lookup requireCurrentAgentActor makes; a resolver context is
    // not a tool context, so it is made directly.
    const user = await findUserById(caller.principalId, agentDb);
    if (!user) return null;
    const digest = await readOfficeDigest(userPrincipal(user), agentDb);
    if (!digest) return null;
    return [
      `## Office snapshot (taken ${formatSydneyDateTime(digest.refreshedAt)})`,
      "Orientation only — use it to understand what the office is talking about and to answer overview questions, saying it is as of the time above. Confirm live values through a specialist before acting.",
      "",
      digest.content,
    ].join("\n");
  } catch (error) {
    // Not an administrator: the expected answer, not a fault.
    if (error instanceof DomainAuthorizationError) return null;
    // Logged without the digest, which is every client's money.
    console.error(
      "[office-snapshot] digest unavailable",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const content = await officeSnapshotInstructions(ctx);
      return content ? defineInstructions({ content }) : null;
    },
  },
});
