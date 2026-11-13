import assert from "node:assert/strict";
import { beforeEach, describe, test, vi } from "vitest";

const reported = vi.hoisted(() => ({
  calls: [] as Array<{ service: string; operation: string; error: unknown }>,
}));
vi.mock("@/lib/observability/external", () => ({
  reportExternalError: (service: string, operation: string, error: unknown) => {
    reported.calls.push({ service, operation, error });
  },
}));

import { instrumentApi, isInstrumented } from "@/lib/observability/instrument";

beforeEach(() => {
  reported.calls.length = 0;
});

class FakeApi {
  accessToken = "initial";
  private secret = "kept";
  async ok(value: number) {
    return value * 2;
  }
  async fails() {
    throw Object.assign(new Error("Xero 503"), {
      response: { statusCode: 503 },
    });
  }
  throwsNow(): never {
    throw new Error("sync boom");
  }
  readSecret() {
    return this.secret;
  }
  notAPromise() {
    return 7;
  }
}

describe("instrumentApi — one hook for every call to a vendor SDK", () => {
  test("a rejecting call is reported with the vendor and the operation, once", async () => {
    const api = instrumentApi("xero", new FakeApi());
    await assert.rejects(() => api.fails());
    assert.equal(reported.calls.length, 1);
    assert.equal(reported.calls[0].service, "xero");
    assert.equal(reported.calls[0].operation, "fails");
  });

  test("the caller still gets the SDK's own rejection, unchanged", async () => {
    const api = instrumentApi("xero", new FakeApi());
    const error = await api.fails().catch((e: unknown) => e);
    assert.equal((error as Error).message, "Xero 503");
    assert.equal(reported.calls[0].error, error, "the very same error object");
  });

  test("a synchronous throw is reported and rethrown", () => {
    const api = instrumentApi("docusign", new FakeApi());
    assert.throws(() => api.throwsNow(), /sync boom/);
    assert.equal(reported.calls[0].operation, "throwsNow");
  });

  test("a successful call passes its result through and reports nothing", async () => {
    const api = instrumentApi("xero", new FakeApi());
    assert.equal(await api.ok(21), 42);
    assert.equal(api.notAPromise(), 7);
    assert.equal(reported.calls.length, 0);
  });

  test("`this`, private state and property writes keep working", () => {
    const api = instrumentApi("xero", new FakeApi());
    assert.equal(api.readSecret(), "kept");
    assert.equal(api.accessToken, "initial");
    // xero-node sets the token on the api object after wrapping.
    api.accessToken = "refreshed";
    assert.equal(api.accessToken, "refreshed");
  });

  test("an unhandled-rejection is not created by the reporter", async () => {
    const seen: unknown[] = [];
    const listener = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const api = instrumentApi("xero", new FakeApi());
      await api.fails().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(seen, []);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  test("a wrapped object is recognisable", () => {
    const raw = new FakeApi();
    assert.equal(isInstrumented(raw), false);
    assert.equal(isInstrumented(instrumentApi("xero", raw)), true);
  });
});
