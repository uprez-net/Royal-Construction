import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// Error reporting only helps if it stays wired. These checks fail when a new
// cron route ships unreported, or when the Next SDK leaks into code Eve bundles.

function read(path: string) {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "tmp")
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (/\.(ts|tsx|mts)$/.test(entry)) found.push(full);
  }
  return found;
}

describe("every cron route reports its failures", () => {
  const vercel = JSON.parse(read("vercel.json")) as {
    crons: { path: string; schedule: string }[];
  };

  for (const { path } of vercel.crons) {
    test(`${path} is wrapped in withCronReporting`, () => {
      const file = `app${path}/route.ts`;
      assert.ok(existsSync(join(REPO_ROOT, file)), `${file} should exist`);
      const source = read(file);
      assert.match(
        source,
        new RegExp(
          `export const GET = withCronReporting\\(\\s*"${path.replace(/\//g, "\\/")}"`,
        ),
        `${file} must export GET through withCronReporting("${path}", …) so a failed run is reported and the path matches vercel.json`,
      );
    });
  }

  test("a cron route nobody scheduled is flagged, not silently unreported", () => {
    const scheduled = new Set(vercel.crons.map((cron) => cron.path));
    const dir = join(REPO_ROOT, "app/api/cron");
    for (const name of readdirSync(dir)) {
      if (!statSync(join(dir, name)).isDirectory()) continue;
      assert.ok(
        scheduled.has(`/api/cron/${name}`),
        `app/api/cron/${name} is not in vercel.json — schedule it or delete it`,
      );
    }
  });
});

describe("the Next SDK stays out of code Eve bundles", () => {
  // `eve build` bundles agent/ and the application modules it imports by value
  // and leaves packages external. @sentry/nextjs imports next/*, which fails
  // that build (see AGENTS.md, "Agent code cannot import Next.js-only
  // packages"). Reporting from shared code goes through @sentry/core.
  const ALLOWED = new Set([
    "instrumentation.ts",
    "instrumentation-client.ts",
    "sentry.server.config.ts",
    "next.config.ts",
  ]);

  test("only the Sentry entry points import @sentry/nextjs", () => {
    const offenders: string[] = [];
    for (const file of walk(REPO_ROOT)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (rel.startsWith("tests/") || ALLOWED.has(rel)) continue;
      if (/from\s+["']@sentry\/nextjs/.test(readFileSync(file, "utf8"))) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "import reportError / reportExternalError from lib/observability instead — they use @sentry/core",
    );
  });
});

describe("one Sentry core", () => {
  // reportError imports @sentry/core directly and reports through whichever
  // client @sentry/nextjs set up. That only works while both resolve to the
  // same copy; a bump of one without the other would make every reportError a
  // silent no-op, and nothing would say so.
  test("@sentry/core and @sentry/nextjs are pinned to the same exact version", () => {
    const { dependencies } = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    const core = dependencies["@sentry/core"];
    const next = dependencies["@sentry/nextjs"];
    assert.match(
      core,
      /^\d+\.\d+\.\d+$/,
      "pin @sentry/core exactly, no ^ or ~",
    );
    assert.equal(core, next, "bump @sentry/core and @sentry/nextjs together");
  });
});

describe("the production gate", () => {
  test("both Sentry configs gate on errorReportingEnabled, not on the DSN alone", () => {
    for (const file of [
      "sentry.server.config.ts",
      "instrumentation-client.ts",
    ]) {
      assert.match(
        read(file),
        /enabled:\s*errorReportingEnabled\(/,
        `${file} must pass \`enabled: errorReportingEnabled(…)\` so preview and staging send nothing even when a DSN is present`,
      );
    }
  });

  test("both configs lock down what an event may carry", () => {
    for (const file of [
      "sentry.server.config.ts",
      "instrumentation-client.ts",
    ]) {
      assert.match(read(file), /dataCollection:\s*DATA_COLLECTION/);
    }
  });
});
