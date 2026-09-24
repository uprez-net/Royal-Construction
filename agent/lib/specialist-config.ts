import { defineAgent, defineDynamic } from "eve";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { SPECIALISTS, type SpecialistName } from "@/agent/lib/specialists";
import { OPERATIONS_MODEL } from "@/lib/agent/model";
import { SPECIALIST_SESSION_LIMITS } from "@/lib/agent/session-limits";

export function defineRCSpecialist(name: SpecialistName) {
  return defineDynamic({
    events: {
      "session.started": (_event, ctx) => {
        const caller = ctx.session.auth.current;
        if (
          process.env.EVE_OPERATIONS_SPECIALISTS_ENABLED !== "true"
          || caller?.principalType !== "user"
        ) {
          return null;
        }

        return defineAgent({
          description: SPECIALISTS[name],
          model: OPERATIONS_MODEL,
          modelContextWindowTokens: 1_000_000,
          reasoning: "low",
          outputSchema: agentResultEnvelopeSchema,
          limits: SPECIALIST_SESSION_LIMITS,
          // Reached only through the root `delegate` workflow tool, never as
          // its own model tool. eve derives every declared subagent's tool as
          // a background task: the orchestrator's turn ends on the receipt,
          // an MCP task-mode invocation then settles as "completed" with the
          // interim text and terminates the specialist, and the browser
          // detaches until the result arrives as a synthetic user message.
          // `delegate` waits for the specialist instead. See
          // agent/tools/delegate.ts.
          tool: false,
        });
      },
    },
  });
}
