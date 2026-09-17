import { defineHook } from "eve/hooks";
import { persistAgentEvent } from "@/agent/lib/event-persistence";

export default defineHook({
  events: {
    async "*"(event, ctx) {
      await persistAgentEvent(event, ctx);
    },
  },
});
