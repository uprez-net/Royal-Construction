import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: null as null | Record<string, unknown>,
  reported: [] as Array<{
    service: string;
    operation: string;
    error: unknown;
    context: Record<string, unknown> | undefined;
  }>,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    xeroConnection: {
      findFirst: async () => {
        if (state.connection === undefined) throw new Error("database is down");
        return state.connection;
      },
      update: async () => ({}),
    },
  },
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

import {
  buildXeroClient,
  getXeroContext,
  XeroNotConnectedError,
} from "@/lib/xero/client";
import { getXeroConfig } from "@/lib/xero/config";
import { isInstrumented } from "@/lib/observability/instrument";

const ENV = {
  XERO_CLIENT_ID: "client-id",
  XERO_CLIENT_SECRET: "client-secret",
  NEXT_PUBLIC_APP_URL: "https://example.test",
};
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  state.reported.length = 0;
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterEach(() => {
  for (const key of Object.keys(ENV)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("every Xero call is reported from one place", () => {
  test("the client's accountingApi is hooked, so each of the call sites is covered", () => {
    const client = buildXeroClient(getXeroConfig());
    assert.equal(isInstrumented(client.accountingApi), true);
  });
});

describe("getXeroContext — the credential failing", () => {
  test("no organisation connected is reported, and any status counts", async () => {
    state.connection = null;
    await assert.rejects(() => getXeroContext(), XeroNotConnectedError);
    assert.equal(state.reported.length, 1);
    assert.equal(state.reported[0].service, "xero");
    assert.equal(state.reported[0].operation, "getContext");
    assert.deepEqual(state.reported[0].context, { force: true });
  });

  test("the error still reaches the caller, so the screen can say 'reconnect'", async () => {
    state.connection = null;
    const error = await getXeroContext().catch((e: unknown) => e);
    assert.ok(error instanceof XeroNotConnectedError);
    assert.match((error as Error).message, /No Xero organisation is connected/);
  });

  test("a database failure is NOT blamed on Xero", async () => {
    state.connection = undefined as never;
    await assert.rejects(() => getXeroContext(), /database is down/);
    assert.equal(state.reported.length, 0);
  });

  test("a connected, unexpired organisation reports nothing", async () => {
    state.connection = {
      id: "c1",
      isActive: true,
      accessToken: "a",
      refreshToken: "r",
      tenantId: "t1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const context = await getXeroContext();
    assert.equal(context.tenantId, "t1");
    assert.equal(state.reported.length, 0);
  });
});
