import assert from "node:assert/strict";
import { wrapLanguageModel } from "ai";
import { beforeEach, describe, test, vi } from "vitest";

const reported = vi.hoisted(() => ({
  calls: [] as Array<{ service: string; operation: string; error: unknown }>,
}));
vi.mock("@/lib/observability/external", () => ({
  reportExternalError: (service: string, operation: string, error: unknown) => {
    reported.calls.push({ service, operation, error });
  },
}));

import { failureReportingMiddleware } from "@/lib/observability/ai";

beforeEach(() => {
  reported.calls.length = 0;
});

// A language model whose calls fail or succeed on demand. Wrapped with the
// SDK's own `wrapLanguageModel`, so this exercises the real middleware plumbing.
function model(behaviour: {
  generate?: () => unknown;
  stream?: () => unknown;
}) {
  return wrapLanguageModel({
    model: {
      specificationVersion: "v4",
      provider: "test",
      modelId: "test/model",
      supportedUrls: {},
      doGenerate: async () => behaviour.generate?.() ?? { content: [] },
      doStream: async () =>
        behaviour.stream?.() ?? { stream: new ReadableStream() },
    } as never,
    middleware: failureReportingMiddleware,
  });
}

const callOptions = { prompt: [] } as never;

function apiFailure(statusCode: number) {
  return Object.assign(new Error(`gateway ${statusCode}`), { statusCode });
}

describe("failureReportingMiddleware — a failed model call, whichever call site made it", () => {
  test("a gateway 503 is reported as the ai vendor and the caller still gets it", async () => {
    const failure = apiFailure(503);
    const wrapped = model({
      generate: () => {
        throw failure;
      },
    });
    const caught = await Promise.resolve(wrapped.doGenerate(callOptions)).catch(
      (e: unknown) => e,
    );
    assert.equal(caught, failure, "the same error, rethrown");
    assert.equal(reported.calls.length, 1);
    assert.equal(reported.calls[0].service, "ai");
    assert.equal(reported.calls[0].operation, "generate");
  });

  test("a failed stream is reported under its own operation", async () => {
    const wrapped = model({
      stream: () => {
        throw apiFailure(502);
      },
    });
    await assert.rejects(async () => await wrapped.doStream(callOptions));
    assert.equal(reported.calls[0].operation, "stream");
  });

  test("a successful call passes straight through and reports nothing", async () => {
    const result = await model({}).doGenerate(callOptions);
    assert.deepEqual(result, { content: [] });
    assert.equal(reported.calls.length, 0);
  });

  test("the wrapped model keeps its identity, so telemetry and routing are unchanged", () => {
    const wrapped = model({});
    assert.equal(wrapped.modelId, "test/model");
    assert.equal(wrapped.provider, "test");
  });
});
