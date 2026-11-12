import { defineDynamic, defineInstructions } from "eve/instructions";
import { agentDb } from "@/agent/lib/db";
import { formatSydneyDateTime } from "@/lib/dates/sydney";
import { readOfficeDigest } from "@/lib/domain/agent-context";
import { findUserById } from "@/lib/domain/identity/users";
import { userPrincipal } from "@/lib/domain/principal";

/**
 * Where the whole business stands, in the orchestrator's context from the
 * first message: leads by stage, offers out for signature, overdue tasks,
 * this week's meetings, jobs in progress, compliance alerts and money owed.
 *
 * Resolved once per session (stable, so the provider can reuse the prompt
 * prefix) from the digest the nightly refresh writes. Administrators only,
 * because it is every client's money; anyone else simply starts without it.
 * A missing digest or a failed read contributes nothing rather than failing
 * the session — the agent can still look everything up.
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
  } catch {
    return null;
  }
}

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const content = await officeSnapshotInstructions(ctx);
      return content ? defineInstructions({ content }) : null;
    },
  },
});
