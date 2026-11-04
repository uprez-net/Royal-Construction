import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";
import { REPO_ROOT } from "../support/repo-root";

// `--sandbox-banner-height` is only set in the sandbox. Everywhere else the
// var() falls back, and a unitless `0` makes `calc(100dvh - 0)` invalid, so
// the declaration drops to `height: auto`. The app shell then grew with its
// content: the window scrolled instead of <main>, the header scrolled away and
// the agent workspace collapsed to its composer on every non-sandbox deploy.

const UNITLESS_FALLBACK = /var\(--sandbox-banner-height,\s*0\s*\)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

test("every --sandbox-banner-height fallback carries a unit", () => {
  const offenders = ["app", "components", "lib"]
    .flatMap((dir) => sourceFiles(join(REPO_ROOT, dir)))
    .filter((path) => UNITLESS_FALLBACK.test(readFileSync(path, "utf8")))
    .map((path) => relative(REPO_ROOT, path));

  assert.deepEqual(offenders, []);
});
