import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// run-capability.test.ts proves the verifier refuses a bare run id, but the hole
// was in the routes: resume-stream handed its path segment straight to getRun,
// and the extract routes returned `runId: run.runId`. Undoing either kept every
// verifier test green while any signed-in user could stream any run again. The
// routes load Clerk, Prisma and the workflow runtime, so this reads their source.

const APP = join(process.cwd(), "app");
const RESUME_STREAM = "app/api/(workflow)/resume-stream/[runId]/route.ts";
// `runId: run.runId` as a response field; the same text as signRunCapability's
// argument is the fix, not the bug.
const BARE_RUN_ID = /(?<!signRunCapability\(\{\s*)\brunId:\s*run\.runId\b/;
const STARTERS = [
  "app/api/(workflow)/extract-project-data/route.ts",
  "app/api/(workflow)/extract-checklist/route.ts",
];

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

function indexIn(source: string, pattern: RegExp, what: string): number {
  const match = pattern.exec(source);
  assert.ok(match, `expected ${what}`);
  return match.index;
}

function routeFiles(): string[] {
  return readdirSync(APP, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => join("app", file));
}

test("resume-stream opens only the run the caller's capability grants", () => {
  const source = read(RESUME_STREAM);

  const verified = /const (\w+) = verifyRunCapability\(\s*capability\s*,\s*user\.id\s*\)/.exec(source);
  assert.ok(verified, "the path segment is not verified against the signed-in user");
  const runId = verified[1];

  const refusal = new RegExp(`if \\(!${runId}\\) \\{\\s*return Response\\.json\\([^)]*\\{ status: 404 \\}`);
  const refusedAt = indexIn(source, refusal, "a 404 when the capability grants nothing");
  const streamedAt = indexIn(source, /getRun\(/, "a getRun call");
  assert.ok(verified.index < refusedAt && refusedAt < streamedAt, "the run is opened before the capability is checked");

  assert.match(source, new RegExp(`getRun\\(${runId}\\)`), "getRun is not given the verified run id");
  assert.doesNotMatch(source, /getRun\(\s*capability\s*\)/);
});

test("the extraction routes hand the client a capability, never the bare run id", () => {
  for (const file of STARTERS) {
    const source = read(file);
    assert.match(
      source,
      /runId: signRunCapability\(\{ runId: run\.runId, userId: user\.id \}\)/,
      `${file} does not bind the run to the signed-in user`,
    );
    assert.doesNotMatch(source, BARE_RUN_ID, `${file} returns the bare run id`);
  }
});

test("no other route streams a run or returns a bare run id", () => {
  for (const file of routeFiles()) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    if (/\bgetRun\b/.test(source)) {
      assert.equal(file, join(RESUME_STREAM), `${file} opens a run without the capability check`);
    }
    assert.doesNotMatch(source, BARE_RUN_ID, `${file} returns the bare run id`);
  }
});
