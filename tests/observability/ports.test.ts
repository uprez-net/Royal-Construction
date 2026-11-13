import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  reported: [] as Array<{
    service: string;
    operation: string;
    error: unknown;
    context: Record<string, unknown> | undefined;
  }>,
  embedMany: vi.fn(),
  ocrProcess: vi.fn(),
  createGraphContext: vi.fn(),
}));

vi.mock("@/lib/observability/external", () => ({
  reportExternalError: (
    service: string,
    operation: string,
    error: unknown,
    context?: Record<string, unknown>,
  ) => {
    state.reported.push({ service, operation, error, context });
  },
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  embedMany: state.embedMany,
}));
vi.mock("@mistralai/mistralai", () => ({
  Mistral: class {
    ocr = { process: state.ocrProcess };
  },
}));
vi.mock("@/lib/graph/config", () => ({ getGraphConfig: () => ({}) }));
vi.mock("@/lib/graph/client", () => ({
  createGraphContext: state.createGraphContext,
}));

function failure(status: number, message = `status ${status}`) {
  return Object.assign(new Error(message), { statusCode: status, status });
}

beforeEach(() => {
  state.reported.length = 0;
  state.embedMany.mockReset();
  state.ocrProcess.mockReset();
  state.createGraphContext.mockReset();
  // azureClient caches its client promise on globalThis outside production, and
  // that survives vi.resetModules(): without this the first test's rejected
  // promise answers every later test.
  delete (globalThis as { graphClientPromise?: unknown }).graphClientPromise;
  vi.resetModules();
});
afterEach(() => {
  Reflect.deleteProperty(process.env, "MISTRAL_AI_KEY");
});

describe("embeddings", () => {
  test("a failed embedMany is reported as the ai vendor and still thrown", async () => {
    const boom = failure(503);
    state.embedMany.mockRejectedValue(boom);
    const { gatewayEmbedding } = await import("@/lib/embedding-port");

    await assert.rejects(
      () => gatewayEmbedding.embed(["a lead summary"]),
      boom,
    );
    assert.equal(state.reported.length, 1);
    assert.equal(state.reported[0].service, "ai");
    assert.equal(state.reported[0].operation, "embedMany");
    assert.equal(state.reported[0].error, boom);
  });

  test("a successful call reports nothing, and an empty batch makes no call", async () => {
    state.embedMany.mockResolvedValue({ embeddings: [[0.1, 0.2]] });
    const { gatewayEmbedding } = await import("@/lib/embedding-port");

    assert.deepEqual(await gatewayEmbedding.embed(["x"]), [[0.1, 0.2]]);
    assert.deepEqual(await gatewayEmbedding.embed([]), []);
    assert.equal(state.embedMany.mock.calls.length, 1);
    assert.equal(state.reported.length, 0);
  });
});

describe("Mistral OCR", () => {
  test("a rejected key (401) is reported, because console capture drops a 4xx", async () => {
    process.env.MISTRAL_AI_KEY = "key";
    const boom = failure(401);
    state.ocrProcess.mockRejectedValue(boom);
    const { processPDFWithMistral } = await import("@/lib/ocr");

    await assert.rejects(
      () => processPDFWithMistral("https://x.test/a.pdf"),
      boom,
    );
    assert.equal(state.reported.length, 1);
    assert.equal(state.reported[0].service, "mistral");
    assert.equal(state.reported[0].operation, "ocr.process");
  });

  test("a successful read returns the pages and reports nothing", async () => {
    process.env.MISTRAL_AI_KEY = "key";
    state.ocrProcess.mockResolvedValue({ pages: [{ markdown: "ok" }] });
    const { processPDFWithMistral } = await import("@/lib/ocr");

    assert.deepEqual(await processPDFWithMistral("https://x.test/a.pdf"), [
      { markdown: "ok" },
    ]);
    assert.equal(state.reported.length, 0);
  });
});

describe("sendEmail — the Graph client and the send are both inside the report", () => {
  const email = { subject: "s", body: "b", to: "client@example.com" };

  test("failing to create the Graph client is reported as a credential failure", async () => {
    // Created once at import by acquiring a token. If that fails the promise is
    // rejected for the life of the instance and every send fails here.
    const boom = Object.assign(new Error("invalid_client"), { status: 400 });
    state.createGraphContext.mockRejectedValue(boom);
    const { sendEmail } = await import("@/lib/azureClient");

    await assert.rejects(() => sendEmail(email), boom);
    assert.equal(state.reported.length, 1);
    assert.equal(state.reported[0].service, "graph");
    assert.equal(state.reported[0].operation, "createContext");
    // A 400 from the token endpoint is our credential, so any status counts.
    assert.deepEqual(state.reported[0].context, { force: true });
  });

  test("a failed send is reported as sendMail, without forcing", async () => {
    const boom = failure(503);
    state.createGraphContext.mockResolvedValue({
      sendMail: async () => {
        throw boom;
      },
    });
    const { sendEmail } = await import("@/lib/azureClient");

    await assert.rejects(() => sendEmail(email), boom);
    assert.equal(state.reported.length, 1);
    assert.equal(state.reported[0].operation, "sendMail");
    assert.deepEqual(state.reported[0].context, { force: false });
  });

  test("a send that works reports nothing", async () => {
    const sendMail = vi.fn(async () => undefined);
    state.createGraphContext.mockResolvedValue({ sendMail });
    const { sendEmail } = await import("@/lib/azureClient");

    await sendEmail(email);
    assert.equal(sendMail.mock.calls.length, 1);
    assert.equal(state.reported.length, 0);
  });

  test("an empty recipient list is refused before anything is attempted", async () => {
    state.createGraphContext.mockResolvedValue({ sendMail: vi.fn() });
    const { sendEmail } = await import("@/lib/azureClient");

    await assert.rejects(
      () => sendEmail({ ...email, to: ["", "  "] }),
      /at least one non-empty recipient/,
    );
    assert.equal(state.reported.length, 0);
  });
});
