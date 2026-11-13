import assert from "node:assert/strict";
import { generateText } from "ai";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

const reported = vi.hoisted(() => ({
  calls: [] as Array<{ service: string; operation: string; error: unknown }>,
}));
vi.mock("@/lib/observability/external", () => ({
  reportExternalError: (service: string, operation: string, error: unknown) => {
    reported.calls.push({ service, operation, error });
  },
}));

const savedKey = process.env.AI_GATEWAY_API_KEY;
process.env.AI_GATEWAY_API_KEY = "test-key-not-real";
// Imported after the key is set: lib/model.ts refuses to load without one.
const { gateway, TEXT_MODEL_ID } = await import("@/lib/model");

let fetchCalls = 0;
beforeEach(() => {
  reported.calls.length = 0;
  fetchCalls = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubGateway(status: number) {
  vi.stubGlobal("fetch", async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({ error: { message: `gateway answered ${status}` } }),
      { status, headers: { "content-type": "application/json" } },
    );
  });
}

// `lib/model.ts` is the one place every app AI call takes its model from, so
// these go through the real `gateway` and the real `generateText` rather than a
// stub model: they prove the wrapping is actually applied, which the middleware
// test alone cannot.
describe("lib/model gateway — every call site is covered by one wrap", () => {
  test("gateway(id), as the ~25 generateText call sites use it", async () => {
    stubGateway(503);
    const failure = await generateText({
      model: gateway(TEXT_MODEL_ID),
      prompt: "hello",
      maxRetries: 0,
    }).catch((e: unknown) => e);

    assert.ok(failure instanceof Error);
    assert.equal(fetchCalls, 1, "the stub, not the network, answered");
    assert.equal(reported.calls.length, 1);
    assert.equal(reported.calls[0].service, "ai");
    assert.equal(reported.calls[0].operation, "generate");
    assert.equal(
      (reported.calls[0].error as { statusCode?: number }).statusCode,
      503,
    );
  });

  test("gateway.languageModel(id) is wrapped the same way", async () => {
    stubGateway(502);
    await assert.rejects(() =>
      generateText({
        model: gateway.languageModel(TEXT_MODEL_ID),
        prompt: "hello",
        maxRetries: 0,
      }),
    );
    assert.equal(reported.calls.length, 1);
  });

  test("the caller still gets the SDK's own error, not a replacement", async () => {
    stubGateway(503);
    const failure = await generateText({
      model: gateway(TEXT_MODEL_ID),
      prompt: "hello",
      maxRetries: 0,
    }).catch((e: unknown) => e);
    assert.match((failure as Error).message, /gateway answered 503/);
  });

  test("the rest of the provider is untouched", () => {
    assert.equal(typeof gateway.languageModel, "function");
    assert.equal(typeof gateway.embeddingModel, "function");
  });
});

if (savedKey === undefined)
  Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
else process.env.AI_GATEWAY_API_KEY = savedKey;
