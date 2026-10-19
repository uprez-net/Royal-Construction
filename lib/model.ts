import { createGateway } from "ai";

if (!process.env.AI_GATEWAY_API_KEY) {
  throw new Error(
    "AI_GATEWAY_API_KEY environment variable is required but not set.",
  );
}

const apiKey = process.env.AI_GATEWAY_API_KEY;

export const gateway = createGateway({
  apiKey,
});

/**
 * The model behind the app's own AI calls: extraction, classification,
 * drafting and judging. One id, so changing model is one line.
 *
 * It is a reasoning model. Two consequences for every caller:
 * - `temperature` and `topK` are ignored (the SDK warns on each call), so
 *   do not set them.
 * - `maxOutputTokens` counts the reasoning as well as the answer. A tight cap
 *   is spent before any text is written and the call returns "" with
 *   finishReason "length"; leave a few hundred tokens of headroom.
 *
 * Eve's model is separate: lib/agent/model.ts.
 */
export const TEXT_MODEL_ID = "openai/gpt-6-luna-fast";
