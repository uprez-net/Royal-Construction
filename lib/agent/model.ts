/**
 * The model the operations orchestrator and every specialist run on, and what
 * it costs.
 *
 * One copy: `agent/agent.ts`, `agent/lib/specialist-config.ts`, the session
 * ceilings in `session-limits.ts` and the workspace's cost meter all read it,
 * so a model change cannot leave the budget sized for the old price.
 */
export const OPERATIONS_MODEL = "openai/gpt-6-luna-fast";

/**
 * List price in US dollars per million tokens, as the AI Gateway publishes it
 * for prompts under 272k tokens. Cached input is a tenth of that ($0.02/M),
 * and an operations turn re-sends the same instructions on every step, so real
 * input spend runs well under list.
 *
 * Why this model and not GLM-5.3-flash, which costs less per token (#429): on
 * the orchestrator's own prompt it starts answering in about a second every
 * time, where GLM ranged from one to four seconds and once took 22 on staging,
 * and it writes five to seven times faster (500–800 tokens/s against ~115). A
 * specialist's typed result is 1,000–2,000 tokens, so that difference alone is
 * most of a specialist's wall-clock time. Its prompt cache also hits on every
 * repeat, which GLM's rarely did.
 */
export const OPERATIONS_MODEL_PRICING = {
  inputUsdPerMillionTokens: 0.2,
  outputUsdPerMillionTokens: 1,
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
