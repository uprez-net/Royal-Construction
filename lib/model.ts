import { createGateway, wrapLanguageModel } from "ai";

import { failureReportingMiddleware } from "@/lib/observability/ai";

if (!process.env.AI_GATEWAY_API_KEY) {
  throw new Error(
    "AI_GATEWAY_API_KEY environment variable is required but not set.",
  );
}

const apiKey = process.env.AI_GATEWAY_API_KEY;

const baseGateway = createGateway({
  apiKey,
});

type GatewayModel = ReturnType<typeof baseGateway>;

// Every model the app asks for is wrapped, so a failed call is reported with
// the vendor and operation from whichever of the ~25 call sites made it.
// `gateway(id)` and `gateway.languageModel(id)` / `.chat(id)` are the ways a
// language model is asked for; everything else on the provider is untouched.
const watched = (model: GatewayModel): GatewayModel =>
  wrapLanguageModel({ model, middleware: failureReportingMiddleware });

export const gateway: typeof baseGateway = new Proxy(baseGateway, {
  apply(target, thisArg, args) {
    return watched(Reflect.apply(target, thisArg, args) as GatewayModel);
  },
  get(target, property) {
    const value = Reflect.get(target, property, target);
    if (
      (property === "languageModel" || property === "chat")
      && typeof value === "function"
    ) {
      return (modelId: string) =>
        watched((value as (id: string) => GatewayModel).call(target, modelId));
    }
    return value;
  },
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
