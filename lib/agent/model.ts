/**
 * The model the operations orchestrator and every specialist run on, and what
 * it costs.
 *
 * One copy: `agent/agent.ts`, `agent/lib/specialist-config.ts`, the session
 * ceilings in `session-limits.ts` and the workspace's cost meter all read it,
 * so a model change cannot leave the budget sized for the old price.
 */
export const OPERATIONS_MODEL = "zai/glm-5.3-flash";

/** List price in US dollars per million tokens. */
export const OPERATIONS_MODEL_PRICING = {
  inputUsdPerMillionTokens: 0.08,
  outputUsdPerMillionTokens: 0.25,
} as const;

/**
 * What a step cost at list price.
 *
 * eve enforces its cost ceiling from the cost the provider reports; this is
 * only the workspace's fallback for a step whose usage arrives without one, so
 * the budget meter does not read $0.00 for real spend.
 */
export function estimateCostUsd(inputTokens: number, outputTokens: number) {
  return (
    (inputTokens * OPERATIONS_MODEL_PRICING.inputUsdPerMillionTokens
      + outputTokens * OPERATIONS_MODEL_PRICING.outputUsdPerMillionTokens)
    / 1_000_000
  );
}
