import { appendFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

/**
 * @typedef {object} Decision
 * @property {boolean} runChecks Whether the quality jobs should run.
 * @property {boolean} deploy Whether the downstream deployment may proceed.
 * @property {string} reason Stable classification reason for logs and artifacts.
 * @property {number} changedFiles Number of changed repository files.
 */

/** @type {string | undefined} */
const outputPath = process.env.GITHUB_OUTPUT;
/** @type {string | undefined} */
const decisionPath = process.env.DECISION_FILE;
/** @type {string | undefined} */
const baseSha = process.env.BASE_SHA;
/** @type {string | undefined} */
const headSha = process.env.HEAD_SHA;
const mergedPullRequest = process.env.MERGED_PULL_REQUEST === "true";

/**
 * @param {string} name
 * @param {string | number | boolean} value
 */
function setOutput(name, value) {
  if (outputPath) {
    appendFileSync(outputPath, `${name}=${value}\n`);
  }
}

/**
 * Whether the Next.js build must run.
 *
 * A merged-PR push deliberately skips the quality suite but still deploys. If
 * the build is skipped with it, that commit produces no `.next/cache` entry and
 * the deployment's `vercel build` starts cold with nothing to warm it — the
 * second gap in issue #327. The build is therefore tied to deployability rather
 * than to the quality gate.
 *
 * @param {Decision} decision
 */
function shouldRunNextBuild(decision) {
  return decision.runChecks || decision.deploy;
}

/** @param {Decision} decision */
function publish(decision) {
  const runNextBuild = shouldRunNextBuild(decision);
  setOutput("run_checks", String(decision.runChecks));
  setOutput("run_next_build", String(runNextBuild));
  setOutput("deploy", String(decision.deploy));
  setOutput("reason", decision.reason);
  setOutput("changed_files", String(decision.changedFiles));

  if (decisionPath) {
    writeFileSync(
      decisionPath,
      `${JSON.stringify(
        {
          runChecks: decision.runChecks,
          runNextBuild,
          deploy: decision.deploy,
          reason: decision.reason,
          changedFiles: decision.changedFiles,
        },
        null,
        2,
      )}\n`,
    );
  }

  console.log(
    `CI decision: ${decision.reason}; ${decision.changedFiles} changed file(s); ` +
      `${decision.runChecks ? "run" : "skip"} quality checks; ` +
      `${runNextBuild ? "run" : "skip"} the Next.js build; ` +
      `${decision.deploy ? "allow" : "skip"} deployment.`,
  );
}

/** @returns {string} */
function resolveBaseSha() {
  if (baseSha && !/^0+$/.test(baseSha)) {
    return baseSha;
  }

  return execFileSync("git", ["rev-parse", `${headSha}^`], {
    encoding: "utf8",
  }).trim();
}

if (!headSha) {
  publish({
    runChecks: true,
    deploy: false,
    reason: "missing-head-sha",
    changedFiles: 0,
  });
  process.exit(0);
}

/** @type {string[]} */
let changedFiles;
/** @type {string | undefined} */
let base;

try {
  base = resolveBaseSha();
  changedFiles = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", base, headSha, "--"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
} catch (error) {
  console.warn(
    "Unable to classify the diff; running the full quality suite.",
    error,
  );
  publish({
    runChecks: true,
    deploy: false,
    reason: "diff-unavailable",
    changedFiles: 0,
  });
  process.exit(0);
}

if (changedFiles.length === 0) {
  publish({
    runChecks: false,
    deploy: false,
    reason: "no-changes",
    changedFiles: 0,
  });
  process.exit(0);
}

const documentationOnly = changedFiles.every((file) =>
  /\.(?:md|mdx)$/i.test(file),
);

if (documentationOnly) {
  publish({
    runChecks: false,
    deploy: false,
    reason: "documentation-only",
    changedFiles: changedFiles.length,
  });
  process.exit(0);
}

const whitespaceDiff = spawnSync(
  "git",
  [
    "diff",
    "--quiet",
    "--ignore-all-space",
    "--ignore-blank-lines",
    base,
    headSha,
    "--",
  ],
  { stdio: "ignore" },
);

if (whitespaceDiff.status === 0) {
  publish({
    runChecks: false,
    deploy: false,
    reason: "whitespace-only",
    changedFiles: changedFiles.length,
  });
  process.exit(0);
}

if (whitespaceDiff.status !== 1) {
  console.warn(
    "Unable to compare substantive changes; running the full quality suite.",
  );
}

if (mergedPullRequest) {
  publish({
    runChecks: false,
    deploy: true,
    reason: "merged-pull-request",
    changedFiles: changedFiles.length,
  });
  process.exit(0);
}

publish({
  runChecks: true,
  deploy: true,
  reason: "source-change",
  changedFiles: changedFiles.length,
});
