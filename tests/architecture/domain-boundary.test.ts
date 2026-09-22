import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  ROOT,
  collectSourceFiles,
  formatViolations,
  valueSpecifiers,
  walkGraph,
} from "./module-graph";

// lib/domain is the one implementation of each business rule (see
// lib/domain/README.md, issue #301). It only stays that way if every channel
// can actually call it, so it may not reach anything that only exists inside
// one of them.
//
// Three separate reasons, all enforced here:
//
// 1. `eve build` bundles authored code and leaves packages to Node's own ESM
//    loader. @clerk/nextjs, next/cache, next/server, next/headers and
//    next/navigation publish extensionless relative imports only a bundler
//    resolves; server-only throws on import outside a React bundler;
//    @clerk/mcp-tools exports no entrypoint Node can resolve. A value import of
//    any of them from agent/ fails the build (AGENTS.md).
// 2. A cron, a webhook, a seed script and this test runner are all plain Node
//    too. A rule that needs a request context is a rule those channels cannot
//    call, which is how the second implementation gets written.
// 3. Importing app/** or agent/** would invert the layering: the domain would
//    depend on an adapter, and the adapter's rule would quietly become the
//    real one again.
//
// `import type` edges are erased before any bundler sees them, so a domain
// module may name a type from a Next-coupled file. Only value edges count.

const DOMAIN_DIR = join(ROOT, "lib", "domain");

test("the graph parser treats .ts generic arrows as TypeScript, not JSX", () => {
  const directory = mkdtempSync(join(tmpdir(), "guri-module-graph-"));
  const file = join(directory, "generic.ts");
  try {
    writeFileSync(
      file,
      'const load = <T>(value: T) => import("./forbidden");\nvoid load;\n',
    );
    assert.deepEqual(valueSpecifiers(file), ["./forbidden"]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

// Packages that only load inside a Next/React server bundle.
const FORBIDDEN_PACKAGES = [
  "server-only",
  "client-only",
  "next",
  "@clerk/nextjs",
  "@clerk/mcp-tools",
  "react",
  "react-dom",
];

function isForbiddenPackage(specifier: string): boolean {
  return FORBIDDEN_PACKAGES.some(
    (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
  );
}

// Layers above the domain. `eve/*` is matched as a package below; these are the
// in-repo directories.
const FORBIDDEN_PREFIXES = ["app/", "agent/", "components/", "hooks/"];

function isForbiddenPath(repoPath: string): boolean {
  return FORBIDDEN_PREFIXES.some((prefix) => repoPath.startsWith(prefix));
}

test("lib/domain reaches no Next-only, Clerk-Next, React or Eve package", () => {
  if (!existsSync(DOMAIN_DIR)) return; // nothing migrated yet

  const { violations } = walkGraph({
    entryFiles: collectSourceFiles(DOMAIN_DIR),
    forbiddenPackage: (specifier) =>
      isForbiddenPackage(specifier)
      || specifier === "eve"
      || specifier.startsWith("eve/"),
    forbiddenPath: isForbiddenPath,
  });

  assert.deepEqual(
    violations,
    [],
    `lib/domain must not reach these. Cut the edge, or make it \`import type\`:\n\n${formatViolations(
      violations,
    )}\n`,
  );
});

test("lib/domain does not import an adapter layer", () => {
  if (!existsSync(DOMAIN_DIR)) return;

  const { violations } = walkGraph({
    entryFiles: collectSourceFiles(DOMAIN_DIR),
    forbiddenPackage: () => false,
    forbiddenPath: isForbiddenPath,
  });

  assert.deepEqual(
    violations,
    [],
    `The domain layer may not depend on an adapter layer:\n\n${formatViolations(
      violations,
    )}\n`,
  );
});
