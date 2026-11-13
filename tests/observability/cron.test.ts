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
  cronOutcome,
  cronSchedule,
  cronSlug,
  monitoredCrons,
  withCronReporting,
} from "@/lib/observability/cron";
import { noteCaptured } from "@/lib/observability/run-context";

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
  const statuses = () =>
    (sdk.captureCheckIn.mock.calls as unknown as CheckInCall[]).map(
      ([checkIn]) => checkIn.status,
    );

  test("no check-ins by default", async () => {
    await withCronReporting(PATH, async () => new Response("ok"))();
    assert.equal(sdk.captureCheckIn.mock.calls.length, 0);
  });

  test("only the named cron checks in; the others do not", async () => {
    process.env.SENTRY_CRON_MONITORS = "graph-renew";
    await withCronReporting(
      "/api/cron/graph-renew",
      async () => new Response("ok"),
    )();
    assert.deepEqual(statuses(), ["ok"]);
    await withCronReporting(
      "/api/cron/sync-sent-mail",
      async () => new Response("ok"),
    )();
    assert.deepEqual(statuses(), ["ok"], "nothing more for the other job");
  });

  test("with SENTRY_CRON_MONITORS=1 a finished run checks in once, on vercel.json's schedule", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    await withCronReporting(PATH, async () => new Response("ok"))();
    const calls = sdk.captureCheckIn.mock.calls as unknown as CheckInCall[];
    assert.deepEqual(statuses(), ["ok"]);
    assert.equal(calls[0][0].monitorSlug, "sync-sent-mail");
    assert.equal(calls[0][1].schedule.value, cronSchedule(PATH));
  });

  test("a thrown run checks in as an error", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    await assert.rejects(() =>
      withCronReporting(PATH, async () => {
        throw new Error("x");
      })(),
    );
    assert.deepEqual(statuses(), ["error"]);
  });

  test("a 5xx the handler answered checks in as an error", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    await withCronReporting(
      PATH,
      async () => new Response("no", { status: 500 }),
    )();
    assert.deepEqual(statuses(), ["error"]);
  });

  // A stranger who knows the URL must not be able to keep a dead job looking
  // healthy. The wrapper used to open a check-in before the handler had checked
  // the secret and close it as a success on a 401.
  test("an unauthenticated request sends no check-in at all, success or failure", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    const unauthorised: (request?: Request) => Promise<Response> = async () =>
      new Response("Unauthorized", { status: 401 });

    for (const agent of ["curl/8.0", "vercel-cron/1.0", ""]) {
      await withCronReporting(
        PATH,
        unauthorised,
      )(
        new Request("https://x.test/c", {
          headers: agent ? { "user-agent": agent } : {},
        }),
      );
    }
    assert.deepEqual(
      statuses(),
      [],
      "the monitor will report the missed run, which is the point",
    );
  });

  test("a rejected 4xx (a bad manual call) is not a successful run", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    await withCronReporting(
      PATH,
      async () => new Response("bad since", { status: 400 }),
    )();
    assert.deepEqual(statuses(), []);
  });
});

describe("cronOutcome — a run that answers 200 with some items failed", () => {
  test("closes the monitor check-in as an error, and leaves the response as it was", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    const response = new Response(JSON.stringify({ failed: 3 }), {
      status: 200,
      headers: { "x-custom": "kept" },
    });
    const returned = await withCronReporting(PATH, async () =>
      cronOutcome(response, { failed: 3 }),
    )();

    assert.equal(returned, response, "the same response object");
    assert.equal(returned.status, 200);
    assert.equal(returned.headers.get("x-custom"), "kept");
    assert.deepEqual(await returned.json(), { failed: 3 });
    const calls = sdk.captureCheckIn.mock.calls as unknown as CheckInCall[];
    assert.deepEqual(
      calls.map(([checkIn]) => checkIn.status),
      ["error"],
    );
  });

  test("a run with nothing failed is still a success", async () => {
    process.env.SENTRY_CRON_MONITORS = "1";
    await withCronReporting(PATH, async () =>
      cronOutcome(new Response("ok"), { failed: 0 }),
    )();
    const calls = sdk.captureCheckIn.mock.calls as unknown as CheckInCall[];
    assert.deepEqual(
      calls.map(([checkIn]) => checkIn.status),
      ["ok"],
    );
  });

  test("the per-item failures are not reported twice: they log where they happen", async () => {
    await withCronReporting(PATH, async () =>
      cronOutcome(new Response("ok"), { failed: 2 }),
    )();
    assert.equal(sdk.captureException.mock.calls.length, 0);
  });
});

describe("a 5xx fallback is only for a handler that said nothing", () => {
  const answers500: (request?: Request) => Promise<Response> = async () =>
    new Response("no", { status: 500 });

  test("a handler that answers 500 in silence is still reported", async () => {
    await withCronReporting(PATH, answers500)();
    assert.equal(sdk.captureException.mock.calls.length, 1);
  });

  test("a handler whose failure was already captured is not reported a second time", async () => {
    // What the server config does for an event that goes out while a run is in
    // progress: the handler's own console.error, say. One failure, one issue.
    await withCronReporting(PATH, async () => {
      noteCaptured();
      return new Response("no", { status: 500 });
    })();
    assert.equal(sdk.captureException.mock.calls.length, 0);
  });

  test("a capture in one run does not suppress the fallback in another", async () => {
    const quiet = withCronReporting(
      PATH,
      async () => new Response("no", { status: 500 }),
    );
    const noisy = withCronReporting(PATH, async () => {
      noteCaptured();
      return new Response("no", { status: 500 });
    });
    await Promise.all([noisy(), quiet()]);
    assert.equal(
      sdk.captureException.mock.calls.length,
      1,
      "only the silent run is reported",
    );
  });

  test("a capture outside any run is harmless", () => {
    assert.doesNotThrow(() => noteCaptured());
  });
});

test("slug and schedule come from the path and vercel.json", () => {
  assert.equal(cronSlug("/api/cron/sync-sent-mail"), "sync-sent-mail");
  assert.equal(cronSchedule("/api/cron/sync-sent-mail"), "0 19 * * *");
  assert.equal(cronSchedule("/api/cron/not-a-job"), undefined);
});
