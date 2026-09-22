import { defineAgent } from "eve";
import { OPERATIONS_SESSION_LIMITS } from "@/lib/agent/session-limits";

export default defineAgent({
  model: "zai/glm-5.3-flash",
  modelContextWindowTokens: 1_000_000,
  reasoning: "low",
  defaultTools: false,
  compaction: {
    thresholdPercent: 0.75,
  },
  limits: OPERATIONS_SESSION_LIMITS,
});
