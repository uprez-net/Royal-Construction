import { defineAgent, defineDynamic } from "eve";
import { agentResultEnvelopeSchema } from "@/agent/lib/result-contracts";

const model = "zai/glm-5.3-flash";

export function defineGuriSpecialist(description: string) {
  return defineDynamic({
    events: {
      "session.started": (_event, ctx) => {
        const caller = ctx.session.auth.current;
        if (
          process.env.EVE_OPERATIONS_SPECIALISTS_ENABLED !== "true" ||
          caller?.principalType !== "user"
        ) {
          return null;
        }

        return defineAgent({
          description,
          model,
          modelContextWindowTokens: 1_000_000,
          reasoning: "low",
          defaultTools: false,
          outputSchema: agentResultEnvelopeSchema,
          limits: {
            maxInputTokensPerSession: 40_000,
            maxOutputTokensPerSession: 4_000,
            maxTokenCostUsdPerSession: 0.25,
            sessionTimeoutMs: 24 * 60 * 60 * 1_000,
          },
        });
      },
    },
  });
}
