/**
 * Per-session ceilings for the Eve operations agent.
 *
 * One copy, imported by both the authored agent definition and the workspace's
 * budget meter. A drifted second copy would show the operator a budget bar that
 * does not match the ceiling the runtime actually enforces, so the meter would
 * read "plenty left" on the turn the session refuses to continue.
 */
export const OPERATIONS_SESSION_LIMITS = {
  maxInputTokensPerSession: 120_000,
  maxOutputTokensPerSession: 12_000,
  maxTokenCostUsdPerSession: 1,
  sessionTimeoutMs: 7 * 24 * 60 * 60 * 1_000,
} as const;

/** Per-session ceilings for each dynamically defined specialist. */
export const SPECIALIST_SESSION_LIMITS = {
  maxInputTokensPerSession: 40_000,
  maxOutputTokensPerSession: 4_000,
  maxTokenCostUsdPerSession: 0.25,
  sessionTimeoutMs: 24 * 60 * 60 * 1_000,
} as const;
