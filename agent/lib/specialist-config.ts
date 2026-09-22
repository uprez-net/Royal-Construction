import { defineAgent, defineDynamic } from "eve";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";
import { SPECIALIST_SESSION_LIMITS } from "@/lib/agent/session-limits";

const model = "zai/glm-5.3-flash";

export function defineRCSpecialist(description: string) {
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
          description,
          model,
          modelContextWindowTokens: 1_000_000,
          reasoning: "low",
          outputSchema: agentResultEnvelopeSchema,
          limits: SPECIALIST_SESSION_LIMITS,
        });
      },
    },
  });
}
