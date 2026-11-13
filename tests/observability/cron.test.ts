import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureCheckIn: vi.fn(() => "run-1"),
  withScope: vi.fn((cb: (s: unknown) => void) =>
    cb({
      setTag() {},
      setContext() {},
      setUser() {},
      setLevel() {},
      setFingerprint() {},
    }),
  ),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/core", () => sdk);

import {
  cronSchedule,
  cronSlug,
  withCronReporting,
} from "@/lib/observability/cron";

const PATH = "/api/cron/sync-sent-mail";

type CheckInCall = [
  { status: string; monitorSlug: string },
  { schedule: { value: string } },
];

beforeEach(() => {
  sdk.captureException.mockClear();
  sdk.captureCheckIn.mockClear();
});
afterEach(() => {
  delete process.env.SENTRY_CRON_MONITORS;
});

describe("withCronReporting", () => {
  test("a thrown error is reported AND rethrown, so the route still answers 500", async () => {
    const boom = new Error("graph down");
    const handler = withCronReporting(PATH, async () => {
      throw boom;
    });
    await assert.rejects(() => handler(), boom);
    assert.equal(sdk.captureException.mock.calls.length, 1);
  });

  test("a 500 the handler answered itself is still reported", async () => {
    const handler = withCronReporting(
      PATH,
      async () => new Response("x", { status: 500 }),
    );
    const response = await handler();
    assert.equal(response.status, 500);
    assert.equal(sdk.captureException.mock.calls.length, 1);
  });

  test("a 401 (no secret) and a 200 are not failures of the job", async () => {
    await withCronReporting(
      PATH,
      async () => new Response("no", { status: 401 }),
    )();
    await withCronReporting(
      PATH,
      async () => new Response("ok", { status: 200 }),
    )();
    assert.equal(sdk.captureException.mock.calls.length, 0);
  });

  test("the handler's own response and arguments pass through untouched", async () => {
    const seen: unknown[] = [];
    const handler = withCronReporting(PATH, async (request: Request) => {
      seen.push(request.url);
      return new Response("body", { status: 202 });
    });
    const response = await handler(new Request("https://x.test/cron?since=1"));
    assert.equal(response.status, 202);
    assert.deepEqual(seen, ["https://x.test/cron?since=1"]);
  });
});

describe("cron monitors — off until someone has checked the plan", () => {
  test("no check-ins by default", async () => {
    await withCronReporting(PATH, async () => new Response("ok"))();
    assert.equal(sdk.captureCheckIn.mock.calls.length, 0);
  });

  test("with SENTRY_CRON_MONITORS=1 a run opens and closes a check-in on vercel.json's schedule", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    await withCronReporting(PATH, async () => new Response("ok"))();
    const calls = sdk.captureCheckIn.mock.calls as unknown as CheckInCall[];
    assert.deepEqual(
      calls.map(([checkIn]) => checkIn.status),
      ["in_progress", "ok"],
    );
    assert.equal(calls[0][0].monitorSlug, "sync-sent-mail");
    assert.equal(calls[0][1].schedule.value, cronSchedule(PATH));
  });

  test("a failed run closes the check-in as an error", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    await assert.rejects(() =>
      withCronReporting(PATH, async () => {
        throw new Error("x");
      })(),
    );
    const calls = sdk.captureCheckIn.mock.calls as unknown as CheckInCall[];
    assert.deepEqual(
      calls.map(([checkIn]) => checkIn.status),
      ["in_progress", "error"],
    );
  });
});

test("slug and schedule come from the path and vercel.json", () => {
  assert.equal(cronSlug("/api/cron/sync-sent-mail"), "sync-sent-mail");
  assert.equal(cronSchedule("/api/cron/sync-sent-mail"), "0 19 * * *");
  assert.equal(cronSchedule("/api/cron/not-a-job"), undefined);
});
