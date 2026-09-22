import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// `eve build` compiles authored code -- everything under agent/, plus the
// application modules it imports -- into one bundle, but leaves installed
// packages external and hands them to Node's own ESM loader. A package whose
// ESM output is not loadable by plain Node therefore fails the build the
// moment authored agent code reaches it by value, with an error that names the
// package's broken internal import rather than our import chain.
//
// @clerk/nextjs is the live example: dist/esm/server/index.js does
// `import { createRouteMatcher } from "./routeMatcher"`, and Node's ESM loader
// does not infer file extensions for relative imports. next/headers,
// next/cache, next/server and next/navigation fail the same way -- Next.js
// publishes them as extensionless files that only a bundler can resolve.
// `server-only` fails differently, by throwing on import, but just as fatally.
//
// This is easy to trip by accident, because so much of lib/ is Next-coupled:
// 18 modules under lib/ value-import @clerk/nextjs today, including
// lib/data/agent-sessions.ts, and most lib/data modules open with
// `import "server-only"`. `import type` edges are erased before the bundler
// sees them and are safe, which is why agent/lib/lead-operations.ts can reach
// types/lead.ts even though that file names lib/data/leads.ts.
//
// Note that `build: { externalDependencies: [...] }` in agent/agent.ts does not
// rescue any of this: it makes a package more external, never bundled.
//
// The agent does not need any of this. Identity arrives at the channel
// boundary (agent/lib/channel-auth.ts authenticates with @clerk/backend, which
// is Node-clean) and tools read it back through ctx.session.auth.current via
// requireCurrentAgentActor.
//
// CI catches the same class in the "Eve build" job. This test exists to fail
// in under a second, locally and on stacked branches that get no CI, and to
// name the import chain that caused it.

const ROOT = REPO_ROOT;
const AGENT_DIR = join(ROOT, "agent");

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

const MODULE_SUFFIXES = [
  "",
  ...CODE_EXTENSIONS,
  ...CODE_EXTENSIONS.map((extension) => `/index${extension}`),
];

type Reachable = {
  /** Bare package specifier -> the authored import chain that first reached it. */
  packages: Map<string, string[]>;
  moduleCount: number;
};

function collectSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(path, found);
    else if (CODE_EXTENSIONS.includes(extname(path))) found.push(path);
  }
  return found;
}

/**
 * Specifiers the bundler will follow. Type-only imports and type-only named
 * specifiers are erased before bundling, so they are deliberately excluded;
 * dynamic `import()` is included because rolldown resolves it too.
 */
function valueSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const specifiers: string[] = [];

  const importsValues = (clause: ts.ImportClause | undefined): boolean => {
    if (!clause) return true; // bare side-effect import
    if (clause.isTypeOnly) return false;
    if (clause.name) return true; // default binding
    const bindings = clause.namedBindings;
    if (!bindings) return true;
    if (ts.isNamespaceImport(bindings)) return true;
    return bindings.elements.some((element) => !element.isTypeOnly);
  };

  const exportsValues = (node: ts.ExportDeclaration): boolean => {
    if (node.isTypeOnly) return false;
    const clause = node.exportClause;
    if (!clause || !ts.isNamedExports(clause)) return true;
    return clause.elements.some((element) => !element.isTypeOnly);
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (importsValues(node.importClause)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (exportsValues(node)) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression)
          && node.expression.text === "require"))
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return specifiers;
}

function resolveAuthored(specifier: string, importer: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(ROOT, specifier.slice(2))
    : resolve(dirname(importer), specifier);
  for (const suffix of MODULE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function collectReachable(): Reachable {
  const roots = collectSourceFiles(AGENT_DIR);
  const visited = new Set(roots);
  const importedBy = new Map<string, string>();
  const packages = new Map<string, string[]>();
  const queue = [...roots];

  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    let current: string | undefined = file;
    while (current) {
      chain.unshift(relative(ROOT, current));
      current = importedBy.get(current);
    }
    return chain;
  };

  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const specifier of valueSpecifiers(file)) {
      if (isBuiltin(specifier) || specifier.startsWith("node:")) continue;

      const isPathLike =
        specifier.startsWith("@/")
        || specifier.startsWith(".")
        || specifier.startsWith("/");

      if (!isPathLike) {
        if (!packages.has(specifier)) {
          packages.set(specifier, [...chainTo(file), specifier]);
        }
        continue;
      }

      const target = resolveAuthored(specifier, file);
      if (!target || target.includes("node_modules") || visited.has(target)) {
        continue;
      }
      visited.add(target);
      importedBy.set(target, file);
      queue.push(target);
    }
  }

  return { moduleCount: visited.size, packages };
}

/**
 * Replays Node's ESM resolution for each specifier without executing it: the
 * package entry must be a real file Node can load, and every relative import
 * inside the package must name an existing file. A relative import that misses
 * is only reported when a sibling with a code extension exists, which is the
 * signature of the extensionless-import bug and keeps arbitrary strings in
 * minified bundles from producing false failures.
 */
const LOADABILITY_PROBE = `
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".node"];
const PATTERNS = [
  /\\bfrom\\s*["']([^"']+)["']/g,
  /\\bimport\\s*\\(\\s*["']([^"']+)["']\\s*\\)/g,
  /^\\s*import\\s*["']([^"']+)["']/gm,
];

const isFile = (url) => {
  try { return statSync(fileURLToPath(url)).isFile(); } catch { return false; }
};
const hasModuleSibling = (url) =>
  EXTENSIONS.some((e) => isFile(url + e) || isFile(url + "/index" + e));

const relativeSpecifiers = (source) => {
  const found = new Set();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1].startsWith(".")) found.add(match[1]);
    }
  }
  return found;
};

const shortName = (url) => url.split("/node_modules/").pop();
const failures = [];

for (const specifier of JSON.parse(process.env.EVE_BOUNDARY_SPECIFIERS)) {
  let entry;
  try {
    entry = import.meta.resolve(specifier);
  } catch (error) {
    failures.push({ specifier, detail: String(error?.message ?? error).split("\\n")[0] });
    continue;
  }
  if (!entry.startsWith("file:")) continue;
  if (!isFile(entry)) {
    failures.push({ specifier, detail: 'resolves to "' + shortName(entry) + '", which is not a file Node can load' });
    continue;
  }

  const seen = new Set([entry]);
  const queue = [entry];
  let reported = false;
  while (queue.length > 0 && !reported) {
    const url = queue.shift();
    let source;
    try { source = readFileSync(fileURLToPath(url), "utf8"); } catch { continue; }
    for (const relativeSpecifier of relativeSpecifiers(source)) {
      let next;
      try { next = new URL(relativeSpecifier, url).href; } catch { continue; }
      if (isFile(next)) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
        continue;
      }
      if (hasModuleSibling(next)) {
        failures.push({
          specifier,
          detail: 'imports "' + relativeSpecifier + '" from ' + shortName(url) +
            " without a file extension; Node's ESM loader does not infer one",
        });
        reported = true;
        break;
      }
    }
  }
}

process.stdout.write(JSON.stringify(failures));
`;

type Failure = { specifier: string; detail: string };

/**
 * Node's ESM resolution, replayed statically over the packages agent/ reaches.
 *
 * Deliberately shallow: it checks each package Node would load, and the
 * relative-import graph inside it. It does NOT follow bare imports on into the
 * packages those name, so a break two packages down escapes it.
 *
 * Following bare specifiers too was tried. It found nothing this does not, and
 * it is markedly slower — as is the obvious alternative of `await import()`-ing
 * every reachable package, which at least has the merit of being exactly what
 * Node does. Neither earns its keep here: this check exists to fail fast and
 * name the import chain, and the eve build in CI already loads everything for
 * real. That one is verified: with a Clerk value import in an agent tool it
 * exits 1, without it 0.
 *
 * So treat a pass here as "the fast check found nothing", not as proof.
 */
function probeNodeEsmLoadability(specifiers: string[]): Failure[] {
  if (specifiers.length === 0) return [];
  const stdout = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", LOADABILITY_PROBE],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        EVE_BOUNDARY_SPECIFIERS: JSON.stringify(specifiers),
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    },
  );
  return JSON.parse(stdout) as Failure[];
}

const reachable = collectReachable();

test("the agent import graph is traced, not silently empty", () => {
  // A canary for the tracer itself: if agent/ moves, or the TypeScript AST
  // walk stops matching, the checks below would pass over an empty graph. The
  // thresholds are far below today's 147 modules and 19 packages, so ordinary
  // growth or pruning of the agent never trips them.
  assert.ok(
    reachable.moduleCount > 50,
    `Only ${reachable.moduleCount} authored modules were traced from agent/; the tracer is not following imports.`,
  );
  assert.ok(
    reachable.packages.size > 5,
    `Only ${reachable.packages.size} packages were traced from agent/; the tracer is not following imports.`,
  );
});

/**
 * Packages that break `eve build` for a reason the resolution probe below
 * cannot see. `server-only` and `client-only` resolve to real files that throw
 * on purpose outside a React bundler, so they fail while evaluating the
 * authored module rather than while loading it. They are named here so the
 * mistake reports itself instead of surfacing as a bundler-shaped error.
 */
function nextOnlyReason(specifier: string): string | null {
  if (specifier === "@clerk/nextjs" || specifier.startsWith("@clerk/nextjs/")) {
    return "Clerk's Next.js binding; use @clerk/backend, or ctx.session.auth.current for the acting user";
  }
  if (specifier === "next" || specifier.startsWith("next/")) {
    return "a Next.js runtime entrypoint, published without file extensions";
  }
  if (specifier === "server-only" || specifier === "client-only") {
    return "a React bundler marker that throws when Node imports it directly";
  }
  if (
    specifier === "@clerk/mcp-tools"
    || specifier.startsWith("@clerk/mcp-tools/")
  ) {
    // Uninstalled with the (mcp) route group in #303. Kept because the
    // failure it causes is confusing and reinstalling it is one command.
    return "has no exported entrypoint; Node answers ERR_PACKAGE_PATH_NOT_EXPORTED";
  }
  return null;
}

test("authored agent code never reaches a Next.js-only package", () => {
  const offenders = [...reachable.packages]
    .map(([specifier, chain]) => ({
      specifier,
      chain,
      reason: nextOnlyReason(specifier),
    }))
    .filter((entry) => entry.reason !== null);

  assert.deepEqual(
    offenders.map((entry) => entry.specifier),
    [],
    `Authored agent code value-imports a Next.js-only package, which breaks \`eve build\`:\n`
      + offenders
        .map(
          (entry) =>
            `  ${entry.specifier} -- ${entry.reason}\n    ${entry.chain.join("\n    -> ")}`,
        )
        .join("\n")
      + `\nAgent tools get the acting user from ctx.session.auth.current`
      + ` (requireCurrentAgentActor); request-scoped Clerk and Next helpers belong in app/ and lib/.`
      + ` Use \`import type\` if you only need the types.`,
  );
});

test("every package reachable from authored agent code loads under Node's ESM loader", () => {
  const specifiers = [...reachable.packages.keys()].sort();
  const failures = probeNodeEsmLoadability(specifiers);

  assert.deepEqual(
    failures,
    [],
    `\`eve build\` leaves installed packages external and loads them with Node's ESM loader.\n`
      + `These packages are reachable by value from agent/ but Node cannot load them:\n`
      + failures
        .map(
          (failure) =>
            `  ${failure.specifier}: ${failure.detail}\n    ${(reachable.packages.get(failure.specifier) ?? []).join("\n    -> ")}`,
        )
        .join("\n"),
  );
});
