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

describe("the outside services stay hooked", () => {
  // Each of these is one hook that covers many call sites. They only keep
  // working while nobody goes round them.

  test("Blob is imported through lib/blob, never straight from the SDK", () => {
    // Types can still come from the SDK; a value import cannot, because it would
    // be a call whose failure is never reported.
    const offenders: string[] = [];
    for (const file of walk(REPO_ROOT)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (rel.startsWith("tests/") || rel === "lib/blob.ts") continue;
      const source = readFileSync(file, "utf8");
      if (
        /(?<!type )import\s*\{[^}]*\}\s*from\s*["']@vercel\/blob["']/.test(
          source,
        )
      ) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'import { put, del, … } from "@/lib/blob" instead: it reports a failed call as the blob vendor',
    );
  });

  test("every model the app asks for comes from the wrapped gateway in lib/model.ts", () => {
    const source = read("lib/model.ts");
    assert.match(source, /wrapLanguageModel\(/);
    assert.match(source, /failureReportingMiddleware/);
    // A second gateway would be a way round the wrap.
    const creators: string[] = [];
    for (const file of walk(REPO_ROOT)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (rel.startsWith("tests/")) continue;
      if (/\bcreateGateway\(/.test(readFileSync(file, "utf8")))
        creators.push(rel);
    }
    assert.deepEqual(creators, ["lib/model.ts"]);
  });

  test("the Novu client is hooked, since triggerNotification swallows its failures", () => {
    assert.match(read("lib/notification/novu.ts"), /instrumentApi\(\s*"novu"/);
  });

  test("Xero and DocuSign are hooked where their clients are built", () => {
    assert.match(read("lib/xero/client.ts"), /instrumentApi\("xero"/);
    // What xero-node rejects with is a JSON string holding the submitted values
    // and the request headers (the access token). Reporting it as it is would
    // send both, so the Xero hook must report the stand-in.
    assert.match(
      read("lib/xero/client.ts"),
      /instrumentApi\("xero",[\s\S]*?summarise:\s*summariseXeroFailure/,
    );
    assert.match(
      read("lib/docusign/client.ts"),
      /instrumentDocusignApiClient\(/,
    );
  });
});

describe("the Node SDK is for the Eve service only", () => {
  // The agent runs as its own service and cannot use @sentry/nextjs. Everything
  // else reports through @sentry/core, which resolves to the same copy.
  test("only agent/lib/error-reporting.ts imports @sentry/node", () => {
    const offenders: string[] = [];
    for (const file of walk(REPO_ROOT)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (rel.startsWith("tests/")) continue;
      if (/from\s+["']@sentry\/node/.test(readFileSync(file, "utf8"))) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(offenders, ["agent/lib/error-reporting.ts"]);
  });

  test("the agent loads it as an instrumentation provider with setup and flush", () => {
    const source = read("agent/instrumentation/sentry.ts");
    assert.match(source, /defineInstrumentation\(/);
    assert.match(source, /setup:\s*initEveErrorReporting/);
    assert.match(source, /flush:\s*flushEveErrorReporting/);
    assert.match(source, /events:\s*eveFailureHandlers/);
  });
});

describe("one Sentry core", () => {
  // reportError imports @sentry/core directly and reports through whichever
  // client @sentry/nextjs set up. That only works while both resolve to the
  // same copy; a bump of one without the other would make every reportError a
  // silent no-op, and nothing would say so.
  test("@sentry/core, @sentry/nextjs and @sentry/node are pinned to the same exact version", () => {
    const { dependencies } = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    const versions = ["@sentry/core", "@sentry/nextjs", "@sentry/node"].map(
      (name) => dependencies[name],
    );
    for (const version of versions) {
      assert.match(
        version,
        /^\d+\.\d+\.\d+$/,
        "pin Sentry packages exactly, no ^ or ~",
      );
    }
    assert.equal(
      new Set(versions).size,
      1,
      "bump @sentry/core, @sentry/nextjs and @sentry/node together",
    );
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

describe("no route answers 500 in silence", () => {
  // The gap this closes: a catch that returned a bare 500 and neither logged
  // nor reported, so a failed booking reached nobody. Console capture reports
  // `console.error` only (sentry.server.config.ts: `warn` is where handled
  // refusals are logged), so a log line is enough; `reportError` adds a source.
  //
  // Coarse on purpose: it works per FILE, so one `console.error` lets a second
  // silent catch in the same file through, and it keys on a literal
  // `status: 500`, so an `errorResponse(...)` that relies on the default 500
  // is not seen. It stops a whole new route shipping silent, not every catch.
  // Matches a CALL (`name(`), not the name: a file that imports `reportError`
  // and never calls it must not pass.
  const REPORTS =
    /console\.error\(|reportError\(|reportExternalError\(|reportWorkflowError\(|withCronReporting\(/;

  // The two catches #497 was about, checked directly rather than by the file-
  // wide guard below. Read as source, not imported: a route reaches
  // `server-only` through lib/data/*, which test-suite-loadable.test.ts
  // forbids a test from loading. The ORDER matters: a refusal returns before
  // the report, so a 4xx is answered and not reported.
  for (const [file, source] of [
    [
      "app/api/(data)/tradie-schedules/route.ts",
      "route:POST /api/tradie-schedules",
    ],
    [
      "app/api/(data)/tradie-schedules/[scheduleId]/route.ts",
      "route:PATCH /api/tradie-schedules/[scheduleId]",
    ],
  ] as const) {
    test(`${file} reports an unexpected failure, after the refusal check`, () => {
      const text = read(file);
      const refusal = text.indexOf("if (refusal) return refusal;");
      const report = text.indexOf("reportError(error");
      assert.ok(refusal >= 0, `${file} should return a domain refusal first`);
      assert.ok(report >= 0, `${file} must call reportError(error, …)`);
      assert.ok(
        refusal < report,
        `${file} must report only after the refusal return, or a 4xx gets reported`,
      );
      assert.ok(
        text.includes(`source: "${source}"`),
        `${file} should label the report ${source}`,
      );
    });
  }

  test("an import without a call does not count as reporting", () => {
    assert.ok(
      !REPORTS.test(
        'import { reportError } from "@/lib/observability/report-error";\nreturn errorResponse("x", { status: 500 });',
      ),
    );
    assert.ok(REPORTS.test("reportError(error, { source: 'route:POST /x' });"));
    assert.ok(REPORTS.test("console.error(\n  'failed',\n);"));
  });

  test("every file under app/ that answers 500 also logs or reports", () => {
    const silent = walk(join(REPO_ROOT, "app"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /status:\s*500/.test(source) && !REPORTS.test(source);
      })
      .map((file) => relative(REPO_ROOT, file));
    assert.deepEqual(
      silent,
      [],
      `these answer 500 and report nothing — add reportError(error, { source }) in the catch:\n${silent.join("\n")}`,
    );
  });
});

describe("a failed project list read is not an empty list (#486)", () => {
  test("getProjects lets the read error through instead of answering an empty page", () => {
    const source = read("lib/data/projects.ts");
    const body = source.slice(
      source.indexOf("export async function getProjects("),
      source.indexOf("export async function getProjectsPage("),
    );
    assert.doesNotMatch(body, /catch/);
    assert.doesNotMatch(body, /items:\s*\[\]/);
  });

  test("the list route answers 500 PROJECTS_FETCH_FAILED when the read fails", () => {
    const source = read("app/api/(data)/projects/route.ts");
    assert.match(
      source,
      /const refusal = domainErrorResponse\(error\);\s*if \(refusal\) return refusal;\s*console\.error\("Error fetching projects:", error\);\s*return errorResponse\("Failed to load projects", \{\s*status: 500,\s*code: "PROJECTS_FETCH_FAILED"/,
    );
  });

  test("the Projects page reads through getProjectsPage and hands the client listFailed", () => {
    const source = read("app/(main)/projects/page.tsx");
    assert.match(source, /getProjectsPage\(projectsListQuery/);
    assert.match(source, /listFailed=\{projectsResult\.failed\}/);
    assert.doesNotMatch(source, /\bgetProjects\(/);
  });
});
