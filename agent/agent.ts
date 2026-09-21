import { defineAgent } from "eve";

export default defineAgent({
  model: "zai/glm-5.3-flash",
  modelContextWindowTokens: 1_000_000,
  reasoning: "low",
  defaultTools: false,
  compaction: {
    thresholdPercent: 0.75,
  },
  limits: {
    maxInputTokensPerSession: 120_000,
    maxOutputTokensPerSession: 12_000,
    maxTokenCostUsdPerSession: 1,
    sessionTimeoutMs: 7 * 24 * 60 * 60 * 1_000,
  },
});
