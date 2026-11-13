import { OPERATIONS_MODEL_PRICING } from "@/lib/agent/model";

/**
 * Per-session ceilings for the Eve operations agent.
 *
 * One copy, imported by both the authored agent definition and the workspace's
 * budget meter. A drifted second copy would show the operator a budget bar that
 * does not match the ceiling the runtime actually enforces, so the meter would
 * read "plenty left" on the turn the session refuses to continue.
 *
 * Token counts are cumulative across every model step, and each step re-sends
 * the conversation, so a handful of tool calls against a long context spends
 * hundreds of thousands of input tokens. At GPT-6-Luna-fast prices
 * (lib/agent/model.ts) that is cents, so the ceilings are sized by dollars: the
 * token ceilings together cost more than the dollar ceiling at list price, so
 * the dollar ceiling is the one that normally stops a runaway session.
 *
 * The input ceilings are deliberately well past that point. Most input is a
 * cached prefix billed at a tenth of list, so a long session reaches a tight
 * token ceiling while it has spent a fraction of its dollars, and a specialist
 * or MCP invocation that hits one fails outright.
 *
 * An interactive session that reaches a ceiling pauses and asks to continue; a
 * task-mode (MCP) invocation or a specialist fails with
 * SESSION_TOKEN_LIMIT_REACHED instead, which is why the specialist ceiling has
 * to cover a full multi-tool request rather than a single lookup. A specialist
 * also inherits whatever cost quota its parent session has left.
 */
export const OPERATIONS_SESSION_LIMITS = {
  // ≈ $7.20 at list price; far less when cached.
  maxInputTokensPerSession: 36_000_000,
  // ≈ $0.60 at list price.
  maxOutputTokensPerSession: 600_000,
  maxTokenCostUsdPerSession: 3,
  sessionTimeoutMs: 7 * 24 * 60 * 60 * 1_000,
} as const;

/** Per-session ceilings for each dynamically defined specialist. */
export const SPECIALIST_SESSION_LIMITS = {
  // ≈ $2.40 at list price; far less when cached.
  maxInputTokensPerSession: 12_000_000,
  // ≈ $0.20 at list price.
  maxOutputTokensPerSession: 200_000,
  maxTokenCostUsdPerSession: 1,
  sessionTimeoutMs: 24 * 60 * 60 * 1_000,
} as const;

/** What spending every token ceiling in `limits` would cost at list price. */
export function listPriceAtCeiling(limits: {
  maxInputTokensPerSession: number;
  maxOutputTokensPerSession: number;
}) {
  return (
    (limits.maxInputTokensPerSession
      * OPERATIONS_MODEL_PRICING.inputUsdPerMillionTokens
      + limits.maxOutputTokensPerSession
        * OPERATIONS_MODEL_PRICING.outputUsdPerMillionTokens)
    / 1_000_000
  );
}
