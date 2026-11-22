// Does this push or pull request change the bridge in a way worth checking?
//
// GitHub's `paths:` filter already limits the workflow to changes under
// services/whatsapp-bridge/. This narrows it further: a change that is only
// reformatting — what `prettier --write` produces, or whitespace in a file
// Prettier has no parser for — runs nothing, and neither does a docs-only
// change. Anything else (logic, dependencies, the Dockerfile, the workflow
// itself) is substantive.
//
// Each changed file is compared as Prettier would print it, before and after:
// if both print the same, the change was formatting. Added and deleted files
// are always substantive. When in doubt — a parse error, a git error — the
// answer is "substantive": skipping a real change is worse than a spare run.
//
// Env: BASE_SHA, HEAD_SHA (from the workflow), GITHUB_OUTPUT,
// GITHUB_STEP_SUMMARY. Run from the repository root, with the service's own
// node_modules installed (Prettier is its devDependency).

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVICE_DIR = path
  .relative(
    process.cwd(),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  )
  .replaceAll("\\", "/");
const WORKFLOW = ".github/workflows/whatsapp-bridge.yml";

const prettier = await import(
  pathToFileURL(path.resolve(SERVICE_DIR, "node_modules/prettier/index.mjs"))
    .href
).catch(() => null);
if (!prettier) {
  console.warn(
    "Prettier is not installed in the service; only whitespace counts as cosmetic.",
  );
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function publish(substantive, reason, details = []) {
  const line = `Bridge CI: ${substantive ? "run" : "skip"} (${reason})`;
  console.log(line);
  for (const detail of details) console.log(`  ${detail}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `substantive=${substantive}\nreason=${reason}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### ${line}\n\n${details.map((detail) => `- ${detail}`).join("\n")}\n`,
    );
  }
  process.exit(0);
}

const head = process.env.HEAD_SHA || "HEAD";
let base = process.env.BASE_SHA;
try {
  if (!base || /^0+$/.test(base)) base = git(["rev-parse", `${head}^`]).trim();
} catch {
  publish(true, "no-base-commit");
}

let entries;
try {
  entries = git([
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    base,
    head,
    "--",
    SERVICE_DIR,
    WORKFLOW,
  ])
    .split("\0")
    .filter(Boolean);
} catch {
  publish(true, "diff-unavailable");
}

const changes = [];
for (let index = 0; index < entries.length; index += 2) {
  changes.push({ file: entries[index + 1], status: entries[index] });
}
if (changes.length === 0) publish(false, "no-changes");

function show(sha, file) {
  return git(["show", `${sha}:${file}`]);
}

async function formatted(file, source) {
  const config = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(source, { ...config, filepath: file });
}

const collapse = (text) => text.replace(/\s+/g, " ").trim();

const substantive = [];
const cosmetic = [];
for (const { file, status } of changes) {
  if (status !== "M") {
    substantive.push(
      `${file} (${status === "A" ? "added" : status === "D" ? "deleted" : status})`,
    );
    continue;
  }
  if (/\.mdx?$/i.test(file)) {
    cosmetic.push(`${file} (docs)`);
    continue;
  }
  let before;
  let after;
  try {
    before = show(base, file);
    after = show(head, file);
  } catch {
    substantive.push(`${file} (unreadable)`);
    continue;
  }
  const info = prettier
    ? await prettier.getFileInfo(file, {
        ignorePath: path.join(SERVICE_DIR, ".prettierignore"),
      })
    : null;
  if (info?.inferredParser && !info.ignored) {
    try {
      if ((await formatted(file, before)) === (await formatted(file, after))) {
        cosmetic.push(`${file} (formatting)`);
      } else {
        substantive.push(file);
      }
    } catch {
      substantive.push(`${file} (did not parse)`);
    }
    continue;
  }
  // Lockfile, Dockerfile, Caddyfile…: only whitespace counts as cosmetic.
  if (collapse(before) === collapse(after))
    cosmetic.push(`${file} (whitespace)`);
  else substantive.push(file);
}

if (substantive.length > 0) {
  publish(true, "source-change", [
    ...substantive.map((entry) => `changed: ${entry}`),
    ...cosmetic.map((entry) => `cosmetic: ${entry}`),
  ]);
}
publish(
  false,
  "formatting-or-docs-only",
  cosmetic.map((entry) => `cosmetic: ${entry}`),
);
