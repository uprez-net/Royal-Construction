import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

// A small authored-module graph walker, shared by the architecture tests.
//
// tests/agent/authored-package-boundary.test.ts walks the same graph from
// agent/ to answer a different question ("can Node load every package this
// reaches?"), and additionally probes node_modules. This one answers "what does
// this directory reach, and did it reach something it is not allowed to?" — so
// it stays in-repo and returns chains rather than loading anything.
//
// Value edges only: `import type` and type-only named specifiers are erased
// before a bundler sees them, so a domain module may name a type from a
// Next-coupled file without pulling it in. Dynamic `import()` counts, because
// it resolves at runtime.

export const ROOT = join(__dirname, "..", "..");

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

export function collectSourceFiles(
  directory: string,
  found: string[] = [],
): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(path, found);
    else if (CODE_EXTENSIONS.includes(extname(path))) found.push(path);
  }
  return found;
}

/** Module specifiers this file imports for their values. */
export function valueSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const specifiers: string[] = [];

  const importsValues = (clause: ts.ImportClause | undefined): boolean => {
    if (!clause) return true; // bare side-effect import, e.g. `import "server-only"`
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
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (importsValues(node.importClause)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (exportsValues(node)) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return specifiers;
}

/** Resolve an in-repo specifier (`@/…`, `./…`) to a file, or null. */
export function resolveAuthored(
  specifier: string,
  importer: string,
): string | null {
  const base = specifier.startsWith("@/")
    ? join(ROOT, specifier.slice(2))
    : resolve(dirname(importer), specifier);
  for (const suffix of MODULE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export type Violation = {
  /** The offending specifier, bare package or repo path. */
  specifier: string;
  /** Repo-relative import chain from an entry file to the file that imports it. */
  chain: string[];
};

export type GraphOptions = {
  /** Files to start from. */
  entryFiles: string[];
  /** True when this bare package specifier is not allowed. */
  forbiddenPackage: (specifier: string) => boolean;
  /**
   * True when this repo-relative path is not allowed. Checked on every module
   * the walk resolves, including the entry files' own directory neighbours.
   */
  forbiddenPath?: (repoRelativePath: string) => boolean;
};

export type GraphResult = {
  violations: Violation[];
  /** Every in-repo module reached, repo-relative. */
  modules: string[];
};

/**
 * Walk the value-import graph from `entryFiles` and report everything
 * forbidden that it reaches, with the chain that reached it.
 *
 * The chain is what makes a failure actionable: "lib/domain/leads/commands.ts
 * → @/lib/data/leads.ts → next/cache" points at the edge to cut, where the
 * package name alone would not.
 */
export function walkGraph(options: GraphOptions): GraphResult {
  const visited = new Set(options.entryFiles);
  const importedBy = new Map<string, string>();
  const violations: Violation[] = [];
  const seenViolations = new Set<string>();
  const queue = [...options.entryFiles];

  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    let current: string | undefined = file;
    while (current) {
      chain.unshift(relative(ROOT, current).split("\\").join("/"));
      current = importedBy.get(current);
    }
    return chain;
  };

  const record = (specifier: string, importer: string) => {
    const key = `${relative(ROOT, importer)}::${specifier}`;
    if (seenViolations.has(key)) return;
    seenViolations.add(key);
    violations.push({ chain: chainTo(importer), specifier });
  };

  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const specifier of valueSpecifiers(file)) {
      if (isBuiltin(specifier) || specifier.startsWith("node:")) continue;

      const isPathLike =
        specifier.startsWith("@/") ||
        specifier.startsWith(".") ||
        specifier.startsWith("/");

      if (!isPathLike) {
        if (options.forbiddenPackage(specifier)) record(specifier, file);
        continue;
      }

      const target = resolveAuthored(specifier, file);
      if (!target || target.includes("node_modules")) continue;

      const repoPath = relative(ROOT, target).split("\\").join("/");
      if (options.forbiddenPath?.(repoPath)) {
        record(repoPath, file);
        continue; // do not walk into a layer it may not reach
      }

      if (visited.has(target)) continue;
      visited.add(target);
      importedBy.set(target, file);
      queue.push(target);
    }
  }

  return {
    modules: [...visited]
      .map((file) => relative(ROOT, file).split("\\").join("/"))
      .sort(),
    violations,
  };
}

export function formatViolations(violations: Violation[]): string {
  return violations
    .map(
      ({ chain, specifier }) =>
        `  ${chain.join("\n    → ")}\n    → ${specifier}`,
    )
    .join("\n\n");
}
