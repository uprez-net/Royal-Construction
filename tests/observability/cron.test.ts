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
  monitoredCrons,
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

describe("a 401 to Vercel's own scheduler means CRON_SECRET no longer matches", () => {
  // Typed as a real cron handler is, so the wrapper's signature is inferred as
  // (request?: Request).
  const unauthorised: (request?: Request) => Promise<Response> = async () =>
    new Response("Unauthorized", { status: 401 });

  test("reported when the caller is vercel-cron, with one fingerprint for the fleet", async () => {
    const request = new Request("https://x.test/api/cron/graph-renew", {
      headers: { "user-agent": "vercel-cron/1.0" },
    });
    const response = await withCronReporting(
      "/api/cron/graph-renew",
      unauthorised,
    )(request);
    assert.equal(response.status, 401, "the 401 itself is untouched");
    assert.equal(sdk.captureException.mock.calls.length, 1);
    const [error] = sdk.captureException.mock.calls[0] as unknown as [Error];
    assert.match(error.message, /CRON_SECRET/);
  });

  test("not reported for a stranger or a browser hitting the public URL", async () => {
    for (const agent of ["curl/8.0", "Mozilla/5.0", ""]) {
      const request = new Request("https://x.test/api/cron/graph-renew", {
        headers: agent ? { "user-agent": agent } : {},
      });
      await withCronReporting("/api/cron/graph-renew", unauthorised)(request);
    }
    assert.equal(sdk.captureException.mock.calls.length, 0);
  });

  test("a handler called with no request at all does not throw", async () => {
    await withCronReporting("/api/cron/graph-renew", unauthorised)();
    assert.equal(sdk.captureException.mock.calls.length, 0);
  });
});

describe("monitoredCrons — one free monitor, so it is a list, not a switch", () => {
  test("empty by default: nothing checks in", () => {
    assert.deepEqual(monitoredCrons(undefined), {
      all: false,
      slugs: new Set(),
    });
    assert.deepEqual(monitoredCrons(""), { all: false, slugs: new Set() });
  });

  test("a comma-separated list names the jobs", () => {
    const { all, slugs } = monitoredCrons(" graph-renew , sync-sent-mail ,");
    assert.equal(all, false);
    assert.deepEqual([...slugs], ["graph-renew", "sync-sent-mail"]);
  });

  test("`all` and the older `1` mean every cron", () => {
    assert.equal(monitoredCrons("all").all, true);
    assert.equal(monitoredCrons("1").all, true);
  });
});

describe("cron monitors — opt-in per job, off until someone has checked the plan", () => {
  test("only the named cron checks in; the others do not", async () => {
    process.env.SENTRY_CRON_MONITORS = "graph-renew";
    await withCronReporting(
      "/api/cron/graph-renew",
      async () => new Response("ok"),
    )();
    const named = sdk.captureCheckIn.mock.calls.length;
    await withCronReporting(
      "/api/cron/sync-sent-mail",
      async () => new Response("ok"),
    )();
    assert.equal(named, 2, "in_progress and ok for the named job");
    assert.equal(
      sdk.captureCheckIn.mock.calls.length,
      2,
      "nothing more for the other job",
    );
  });

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
