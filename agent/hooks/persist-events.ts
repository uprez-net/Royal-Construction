import { defineHook } from "eve/hooks";
import { persistAgentEvent } from "../lib/event-persistence";

export default defineHook({
  events: {
    async "*"(event, ctx) {
      await persistAgentEvent(event, ctx);
    },
  },
});
