import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import {
  SPECIALISTS,
  DELEGATE_TARGETS,
  type SpecialistName,
} from "@/agent/lib/specialists";

/**
 * The orchestrator's only way to reach a specialist, and it waits.
 *
 * eve lowers every declared subagent into a *background* tool: the call returns
 * a `{ status: "working" }` receipt, the parent's turn ends, and a task
 * notification wakes it later. Both of our surfaces break on that:
 *
 * - An MCP `agent_start` runs one task-mode session. A task-mode turn that ends
 *   with pending background work finishes the session, and finishing a session
 *   terminates its children. The client read `completed` with "I'll share the
 *   results once the task completes" and the specialist was killed — a
 *   reported success with nothing behind it.
 * - The /agent workspace detached at the parked turn, never saw the specialist
 *   finish, and on reload rendered the completion as a user message containing
 *   the raw result envelope.
 *
 * A blocking workflow tool keeps the parent turn open until the specialist
 * settles. The specialists set `tool: false`, so this is the only route.
 * Approvals raised inside a specialist still surface on the parent session (and
 * as `input_required` over MCP), and a specialist failure comes back as a
 * failed tool result the orchestrator has to report.
 */
export default defineWorkflowTool({
  description: [
    "Hand one self-contained request to an operations specialist and wait for its typed result.",
    "The specialist does not see this conversation: put every name, id, date and constraint it needs in `request`.",
    "Independent read-only requests may be delegated in parallel; delegate writes one at a time.",
    "Specialists:",
    ...DELEGATE_TARGETS.map((name) => `- ${name}: ${SPECIALISTS[name]}`),
  ].join("\n"),
  inputSchema: z.object({
    specialist: z.enum(DELEGATE_TARGETS),
    request: z.string().trim().min(1).max(16_000),
  }),
  async execute({ specialist, request }, ctx) {
    "use workflow";
    // A specialist is omitted for a session that is not a signed-in user, or
    // while EVE_OPERATIONS_SPECIALISTS_ENABLED is off. Say so plainly rather
    // than letting eve fail the call with a generic "not available" error.
    if (!Object.hasOwn(ctx.agents, specialist)) {
      return unavailable(specialist);
    }
    const output = await ctx.agent(specialist, { message: request });
    return tagged(specialist, output);
  },
});

/**
 * The specialist's own result envelope, with the specialist named on it.
 *
 * Returned at the top level rather than nested so the workspace renders it as
 * the same rich result card any other enveloped tool output gets.
 */
function tagged(specialist: SpecialistName, output: unknown) {
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    return { ...(output as Record<string, unknown>), specialist };
  }
  return { specialist, output };
}

function unavailable(specialist: SpecialistName) {
  return {
    version: 1,
    kind: "error",
    specialist,
    title: "Specialist unavailable",
    summary: `The ${specialist} specialist is not available in this session, so nothing was looked up or changed.`,
  };
}
