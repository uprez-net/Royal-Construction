import { defineHook } from "eve/hooks";
import { generateText } from "ai";
import { createAgentEventPersister } from "@/agent/lib/event-persistence";
import { createConversationTitleGenerator } from "@/agent/lib/session-title";
import { gateway } from "@/lib/model";

const persistAgentEvent = createAgentEventPersister(
  createConversationTitleGenerator({ generateText, gateway }),
);

export default defineHook({
  events: {
    async "*"(event, ctx) {
      await persistAgentEvent(event, ctx);
    },
  },
});
