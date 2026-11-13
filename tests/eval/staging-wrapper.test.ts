import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import {
  forwardedArgs,
  runStagingEval,
  targetUrlFrom,
} from "@/scripts/eve-eval-staging";
import { EVAL_AUTH_HEADER, EVAL_SESSION_HEADER } from "@/lib/eval/staging-auth";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

/**
 * The wrapper's target and argument guards, plus token cleanup across the
 * bootstrap, preflight and evaluator lifecycle.
 *
 * Both are guards rather than conveniences. The first is what stops a live
 * write run being pointed at production by a typo; the second is what stops
 * mutation cases racing each other on one staging database.
 */

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("runStagingEval", () => {
  const target = "https://guri-abc123.vercel.app";
  const token = `header.${Buffer.from(JSON.stringify({ sid: "sess_eval" })).toString("base64url")}.signature`;
  const bootstrap = {
    token,
    expiresInSeconds: 300,
    environment: "preview",
    operationsAgentEnabled: true,
    specialistsEnabled: true,
    databaseLabel: "staging",
    fixtureVersion: "v1",
  };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    process.env.EVE_EVAL_AUTH_SECRET = "test-secret";
    delete process.env.EVE_EVAL_STAGING_HOST;
    delete process.env.EVE_EVAL_EXPECTED_DATABASE_LABEL;
    delete process.env.EVE_EVAL_FIXTURE_VERSION;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(Response.json(bootstrap))
      .mockResolvedValueOnce(
        Response.json({ kind: "eve-agent-info", version: 5 }),
      )
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(spawn).mockReset();
    vi.mocked(spawn).mockImplementation(() => {
      const child = new ChildProcess();
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    });
  });

  function assertRevoked(): void {
    const calls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === `${target}/api/eval/auth/revoke`,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], {
      cache: "no-store",
      headers: {
        [EVAL_AUTH_HEADER]: "test-secret",
        [EVAL_SESSION_HEADER]: "sess_eval",
      },
      method: "POST",
    });
  }

  it("accepts v5, runs the evaluator with its token, and revokes on success", async () => {
    assert.equal(await runStagingEval(["--url", target, "smoke"]), 0);
    assert.equal(vi.mocked(spawn).mock.calls.length, 1);
    assert.equal(
      vi.mocked(spawn).mock.calls[0][2]?.env?.EVE_EVAL_AUTH_TOKEN,
      token,
    );
    assertRevoked();
  });

  for (const info of [
    { kind: "eve-agent-info", version: 4 },
    { kind: "eve-agent-info", version: 6 },
    { kind: "eve-agent-info", version: "5" },
    { kind: "other", version: 5 },
  ]) {
    it(`refuses ${JSON.stringify(info)} and revokes before spawning`, async () => {
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(Response.json(bootstrap))
        .mockResolvedValueOnce(Response.json(info))
        .mockResolvedValue(new Response(null, { status: 204 }));
      await assert.rejects(runStagingEval(["--url", target]), /Eve v5/);
      assert.equal(vi.mocked(spawn).mock.calls.length, 0);
      assertRevoked();
    });
  }

  for (const response of [
    new Response(null, { status: 503 }),
    new Response("invalid JSON"),
  ]) {
    it(`revokes when the info response is unusable: ${response.status}`, async () => {
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(Response.json(bootstrap))
        .mockResolvedValueOnce(response)
        .mockResolvedValue(new Response(null, { status: 204 }));
      await assert.rejects(runStagingEval(["--url", target]), /Eve info check/);
      assert.equal(vi.mocked(spawn).mock.calls.length, 0);
      assertRevoked();
    });
  }

  for (const invalid of [
    { operationsAgentEnabled: false },
    { specialistsEnabled: false },
    { environment: "production" },
    { expiresInSeconds: 301 },
    { databaseLabel: "wrong" },
    { fixtureVersion: "wrong" },
  ]) {
    it(`revokes a minted token when bootstrap validation refuses ${JSON.stringify(invalid)}`, async () => {
      process.env.EVE_EVAL_EXPECTED_DATABASE_LABEL = "staging";
      process.env.EVE_EVAL_FIXTURE_VERSION = "v1";
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(Response.json({ ...bootstrap, ...invalid }))
        .mockResolvedValue(new Response(null, { status: 204 }));
      await assert.rejects(runStagingEval(["--url", target]));
      assert.equal(vi.mocked(spawn).mock.calls.length, 0);
      assertRevoked();
    });
  }

  it("revokes when argument validation fails after preflight", async () => {
    await assert.rejects(
      runStagingEval(["--url", target, "--max-concurrency", "2"]),
      /max-concurrency 1/,
    );
    assert.equal(vi.mocked(spawn).mock.calls.length, 0);
    assertRevoked();
  });

  it("revokes when the info request rejects", async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(Response.json(bootstrap))
      .mockRejectedValueOnce(new Error("info network failure"))
      .mockResolvedValue(new Response(null, { status: 204 }));
    await assert.rejects(
      runStagingEval(["--url", target]),
      /info network failure/,
    );
    assert.equal(vi.mocked(spawn).mock.calls.length, 0);
    assertRevoked();
  });

  it("does not attempt revocation when authentication fails without a token", async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await assert.rejects(runStagingEval(["--url", target]), /HTTP 401/);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(vi.mocked(spawn).mock.calls.length, 0);
  });

  it("preserves evaluator failure and revokes", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const child = new ChildProcess();
      queueMicrotask(() => child.emit("exit", 2, null));
      return child;
    });
    assert.equal(await runStagingEval(["--url", target]), 2);
    assertRevoked();
  });

  it("revokes when the evaluator cannot start", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const child = new ChildProcess();
      queueMicrotask(() => child.emit("error", new Error("spawn failed")));
      return child;
    });
    await assert.rejects(runStagingEval(["--url", target]), /spawn failed/);
    assertRevoked();
  });

  for (const failure of [
    new Response(null, { status: 500 }),
    new Error("network failed"),
  ]) {
    it(`reports revoke failure without masking the original error: ${String(failure)}`, async () => {
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(Response.json(bootstrap))
        .mockResolvedValueOnce(
          Response.json({ kind: "eve-agent-info", version: 4 }),
        );
      if (failure instanceof Error) fetchMock.mockRejectedValueOnce(failure);
      else fetchMock.mockResolvedValueOnce(failure);
      await assert.rejects(runStagingEval(["--url", target]), /Eve v5/);
      assertRevoked();
      assert.ok(
        vi
          .mocked(console.error)
          .mock.calls.some(([message]) =>
            String(message).includes("Could not revoke"),
          ),
      );
    });
  }
});

describe("targetUrlFrom", () => {
  it("accepts a Vercel preview host with no explicit staging host", () => {
    const url = targetUrlFrom(["--url", "https://guri-abc123.vercel.app"]);
    assert.equal(url.origin, "https://guri-abc123.vercel.app");
  });

  it("reads STAGING_URL when --url is not passed", () => {
    process.env.STAGING_URL = "https://guri-abc123.vercel.app";
    assert.equal(targetUrlFrom([]).origin, "https://guri-abc123.vercel.app");
  });

  it("refuses a target with no URL at all", () => {
    delete process.env.STAGING_URL;
    assert.throws(() => targetUrlFrom([]), /STAGING_URL/);
  });

  it("refuses plain HTTP and embedded credentials", () => {
    assert.throws(
      () => targetUrlFrom(["--url", "http://guri-abc123.vercel.app"]),
      /HTTPS/,
    );
    assert.throws(
      () => targetUrlFrom(["--url", "https://user:pass@guri-abc.vercel.app"]),
      /without credentials/,
    );
  });

  it("refuses an arbitrary host until one is named", () => {
    delete process.env.EVE_EVAL_STAGING_HOST;
    assert.throws(
      () => targetUrlFrom(["--url", "https://royalconstructions.com.au"]),
      /EVE_EVAL_STAGING_HOST/,
    );
  });

  it("pins to exactly the configured staging host once one is named", () => {
    process.env.EVE_EVAL_STAGING_HOST = "staging.example.test";
    assert.equal(
      targetUrlFrom(["--url", "https://staging.example.test/"]).hostname,
      "staging.example.test",
    );
    // A Vercel host is no longer a free pass, and neither is a subdomain that
    // merely ends with the configured one.
    assert.throws(
      () => targetUrlFrom(["--url", "https://guri-abc123.vercel.app"]),
      /configured staging host/,
    );
    assert.throws(
      () => targetUrlFrom(["--url", "https://evil.staging.example.test"]),
      /configured staging host/,
    );
  });
});

describe("forwardedArgs", () => {
  const target = new URL("https://guri-abc123.vercel.app/some/path");

  it("adds the defaults a staging run must always have", () => {
    const args = forwardedArgs([], target);
    assert.ok(args.includes("--strict"));
    assert.deepEqual(
      args.slice(args.indexOf("--junit"), args.indexOf("--junit") + 2),
      ["--junit", ".eve/staging-junit.xml"],
    );
    assert.deepEqual(
      args.slice(
        args.indexOf("--max-concurrency"),
        args.indexOf("--max-concurrency") + 2,
      ),
      ["--max-concurrency", "1"],
    );
  });

  it("forwards the target origin, not the operator's path", () => {
    const args = forwardedArgs([], target);
    assert.deepEqual(args.slice(-2), [
      "--url",
      "https://guri-abc123.vercel.app",
    ]);
  });

  it("strips an operator-supplied --url in either spelling", () => {
    const spaced = forwardedArgs(["--url", "https://elsewhere.test"], target);
    assert.equal(spaced.filter((arg) => arg === "--url").length, 1);
    assert.ok(!spaced.includes("https://elsewhere.test"));

    const equals = forwardedArgs(["--url=https://elsewhere.test"], target);
    assert.ok(!equals.some((arg) => arg.startsWith("--url=")));
  });

  it("keeps the operator's own filters and tags", () => {
    const args = forwardedArgs(["safety", "--tag", "injection"], target);
    assert.ok(args.includes("safety"));
    assert.deepEqual(
      args.slice(args.indexOf("--tag"), args.indexOf("--tag") + 2),
      ["--tag", "injection"],
    );
  });

  it("drops the leading -- pnpm forwards, so eve still parses --url", () => {
    const args = forwardedArgs(["--", "smoke"], target);
    assert.ok(!args.includes("--"));
    assert.equal(args[0], "smoke");
    assert.deepEqual(args.slice(-2), [
      "--url",
      "https://guri-abc123.vercel.app",
    ]);
  });

  it("refuses to run mutation cases in parallel", () => {
    assert.throws(
      () => forwardedArgs(["--max-concurrency", "4"], target),
      /max-concurrency 1/,
    );
    // Explicitly asking for 1 is fine and is not duplicated.
    const args = forwardedArgs(["--max-concurrency", "1"], target);
    assert.equal(args.filter((arg) => arg === "--max-concurrency").length, 1);
  });

  it("does not double up flags the operator already passed", () => {
    const args = forwardedArgs(["--strict", "--junit", "out.xml"], target);
    assert.equal(args.filter((arg) => arg === "--strict").length, 1);
    assert.equal(args.filter((arg) => arg === "--junit").length, 1);
    assert.ok(args.includes("out.xml"));
    assert.ok(!args.includes(".eve/staging-junit.xml"));
  });
});
