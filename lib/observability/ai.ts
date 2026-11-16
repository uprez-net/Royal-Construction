// Reports a failed model call, whichever of the ~25 call sites made it.
//
// Every `generateText` in the app takes `gateway(TEXT_MODEL_ID)` from
// `lib/model.ts`. Wrapping the model there is one hook for the lot: lead
// extraction, document classification, compliance alerts, offer drafting.
// Several of those catch the failure and carry on with an empty result, so
// without this an outage of the model provider shows up as documents that
// quietly stop being read.
//
// Reported through `reportExternalError`: a 5xx, a 401/403 (our gateway key),
// and a call that got no answer. A 429 or a 400 is not. Each failed attempt is
// seen here, including the ones the SDK then retries; they group into one issue
// by operation and status, so a blip is one issue, not one email per call.

import type { LanguageModelMiddleware, TranscriptionModel } from "ai";

type TranscriptionModelV4 = Extract<
  TranscriptionModel,
  { readonly specificationVersion: "v4" }
>;

import { reportExternalError } from "./external";

export const failureReportingMiddleware: LanguageModelMiddleware = {
  wrapGenerate: async ({ doGenerate }) => {
    try {
      return await doGenerate();
    } catch (error) {
      reportExternalError("ai", "generate", error);
      throw error;
    }
  },
  wrapStream: async ({ doStream }) => {
    try {
      return await doStream();
    } catch (error) {
      reportExternalError("ai", "stream", error);
      throw error;
    }
  },
};

/**
 * The same report for a transcription model (call recordings), which has no
 * middleware hook of its own: `doGenerate` is wrapped in place of one.
 */
export function watchTranscriptionModel(
  model: TranscriptionModelV4,
): TranscriptionModelV4 {
  return new Proxy(model, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "doGenerate" || typeof value !== "function") {
        return value;
      }
      return async (
        ...args: Parameters<TranscriptionModelV4["doGenerate"]>
      ) => {
        try {
          return await (value as TranscriptionModelV4["doGenerate"]).apply(
            target,
            args,
          );
        } catch (error) {
          reportExternalError("ai", "transcribe", error);
          throw error;
        }
      };
    },
  });
}
