import type { ModelMessage } from "ai";
import { defineDynamic } from "eve";
import { connectionSearch } from "eve/tools/connection_search";

/**
 * Offer connection discovery only in a conversation about Plaud recordings.
 *
 * eve adds `connection_search` whenever the agent has a connection, and Plaud
 * is the only one. A search asks every connection for its tools, so for a
 * caller without a Plaud grant ANY search raises Plaud's OAuth prompt, ends the
 * turn and leaves the session waiting with no reply. The orchestrator reached
 * for it on non-Plaud questions: the build sequence (staging eval run
 * 43505272370) and "what was I told in my other conversation". The office got
 * silence.
 *
 * This slot replaces the framework tool (eve docs: built-in tools,
 * connection_search) and hands the step to the framework's own resolver when
 * a user message mentions Plaud, so a Plaud conversation behaves exactly as
 * before, follow-ups included. Otherwise the tool is not offered for that step.
 *
 * ponytail: keyword gate. A Plaud request worded without any of these words
 * gets no Plaud tools and the agent says it cannot find the recording; add the
 * word here, or move Plaud into its own specialist if that keeps happening.
 */
const PLAUD_REQUEST =
  /\b(plaud|recordings?|recorded|transcripts?|transcription|voice (memo|note)s?)\b/i;

function userText(message: ModelMessage): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ");
}

export function mentionsPlaud(messages: readonly ModelMessage[]): boolean {
  return messages.some((message) => PLAUD_REQUEST.test(userText(message)));
}

const discover = connectionSearch.events["step.started"];

export default defineDynamic({
  events: {
    "step.started": (event, ctx) =>
      discover && mentionsPlaud(ctx.messages) ? discover(event, ctx) : null,
  },
});
