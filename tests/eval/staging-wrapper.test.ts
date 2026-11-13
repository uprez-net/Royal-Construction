import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { forwardedArgs, targetUrlFrom } from "@/scripts/eve-eval-staging";

/**
 * The wrapper's two pure decisions: which target is allowed, and which flags
 * reach `eve eval`.
 *
 * Both are guards rather than conveniences. The first is what stops a live
 * write run being pointed at production by a typo; the second is what stops
 * mutation cases racing each other on one staging database.
 */

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
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
