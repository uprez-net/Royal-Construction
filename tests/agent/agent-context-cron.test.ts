import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const calls = vi.hoisted(() => ({
  records: vi.fn(async () => ({
    embedded: 1,
    embeddingFailed: false,
    removed: 0,
    scanned: 3,
    unchanged: 2,
  })),
  documents: vi.fn(async () => ({
    documents: 4,
    embedded: 9,
    embeddingFailed: false,
    extracted: 2,
    failed: 0,
    passages: 9,
    pending: 1,
    readerUnavailable: false,
    removed: 0,
    unsupported: 1,
  })),
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/embedding-port", () => ({
  gatewayEmbedding: { kind: "embedding" },
}));
vi.mock("@/lib/document-text-port", () => ({
  documentTextReader: { kind: "reader" },
}));
vi.mock("@/lib/domain/agent-context", () => ({
  refreshAgentContext: calls.records,
  refreshAgentFiles: calls.documents,
}));

const { GET } = await import("@/app/api/cron/agent-context/route");

// The nightly run refreshes the record snapshots and then the uploaded
// documents filed under them, inside the function's time limit.

const previousSecret = process.env.CRON_SECRET;
beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
});
afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
  vi.clearAllMocks();
});

function request(secret = "test-secret") {
  return new Request("http://localhost/api/cron/agent-context", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

test("the nightly run refreshes records, then reads documents with a deadline", async () => {
  const before = Date.now();
  const response = await GET(request());
  assert.equal(response.status, 200);

  assert.equal(calls.records.mock.calls.length, 1);
  assert.equal(calls.documents.mock.calls.length, 1);
  const [, input, , ports] = calls.documents.mock.calls[0] as unknown as [
    unknown,
    { deadline: Date },
    unknown,
    { documentText: unknown; embedding: unknown },
  ];
  // Reading stops with time left to write and embed inside maxDuration (300 s).
  const budget = input.deadline.getTime() - before;
  assert.ok(budget > 60_000 && budget < 280_000, `budget ${budget} ms`);
  assert.deepEqual(ports, {
    documentText: { kind: "reader" },
    embedding: { kind: "embedding" },
  });

  const body = (await response.json()) as {
    data: {
      scanned: number;
      documents: { extracted: number; pending: number };
    };
  };
  assert.equal(body.data.scanned, 3);
  assert.equal(body.data.documents.extracted, 2);
  assert.equal(body.data.documents.pending, 1, "a backlog is visible");
});

test("without the cron bearer nothing runs", async () => {
  const response = await GET(request("wrong"));
  assert.equal(response.status, 401);
  assert.equal(calls.records.mock.calls.length, 0);
  assert.equal(calls.documents.mock.calls.length, 0);
});
