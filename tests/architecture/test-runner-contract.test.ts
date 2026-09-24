import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { test } from "vitest";

import { ROOT, collectSourceFiles } from "./module-graph";

// What issue #326 actually bought, guarded so it cannot quietly come back.
//
// The suite moved off `tsx --test` onto Vitest. Two things went wrong under the
// old runner and are cheap to prevent under the new one:
//
//   * Seven files held ~78 assertions at module scope and registered no test.
//     `tsx --test` executed them, so they "passed" — but they reported no test
//     names, and an assertion added to one of them was invisible in the output.
//     A file that registers nothing is a file nobody reads the results of.
//   * A `node:test` import in a Vitest run is worse: the functions exist, so
//     the file loads and reports zero tests instead of failing. That is the
//     silent-failure shape this repo treats as the expensive kind.
//
// This file also pins the CI contract: the Chromium lane stays out of
// `test:unit`, and nothing is quarantined with .only/.skip/.todo. None of that
// is enforceable by the runner itself.

const TESTS_DIR = join(ROOT, "tests");

const REGISTRARS = new Set(["test", "it", "describe", "suite", "bench"]);

/** Modifiers that would hide a test's result rather than report it. */
const FORBIDDEN_MODIFIERS = new Set([
  "only",
  "skip",
  "todo",
  "skipIf",
  "runIf",
]);

const testFiles = collectSourceFiles(TESTS_DIR)
  .filter((file) => file.endsWith(".test.ts"))
  .sort();

const repoPath = (file: string) => relative(ROOT, file).split("\\").join("/");

type FileFacts = {
  path: string;
  importsNodeTest: boolean;
  registrations: number;
  modifiers: string[];
};

function readFacts(file: string): FileFacts {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  let importsNodeTest = false;
  let registrations = 0;
  const modifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === "node:test"
    ) {
      importsNodeTest = true;
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && REGISTRARS.has(callee.text)) {
        registrations += 1;
      } else if (
        ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression)
        && REGISTRARS.has(callee.expression.text)
      ) {
        registrations += 1;
        if (FORBIDDEN_MODIFIERS.has(callee.name.text)) {
          modifiers.push(`${callee.expression.text}.${callee.name.text}`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

  return { path: repoPath(file), importsNodeTest, registrations, modifiers };
}

const facts = testFiles.map(readFacts);

/**
 * The `print` project's file list, read out of vitest.config.mts itself.
 *
 * Read rather than imported: importing a repo module into the Vite config makes
 * the config non-native, and duplicating the list here would be the second copy
 * this repo treats as a defect. Parsed with the TypeScript AST so a comment
 * mentioning a path cannot be mistaken for the list.
 */
const printTests = (() => {
  const configPath = join(ROOT, "vitest.config.mts");
  const config = ts.createSourceFile(
    configPath,
    readFileSync(configPath, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  for (const statement of config.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== "PRINT_TESTS") continue;
      const initializer = declaration.initializer;
      assert.ok(
        initializer && ts.isArrayLiteralExpression(initializer),
        "PRINT_TESTS in vitest.config.mts must be an array literal",
      );
      return initializer.elements.map((element) => {
        assert.ok(
          ts.isStringLiteral(element),
          "every PRINT_TESTS entry must be a plain string",
        );
        return element.text;
      });
    }
  }

  throw new Error("vitest.config.mts no longer declares PRINT_TESTS");
})();

test("the suite has test files to check", () => {
  // Without this, every assertion below passes vacuously if the glob breaks.
  assert.ok(
    facts.length > 150,
    `expected the whole suite, found ${facts.length} files`,
  );
});

test("no test file still imports node:test", () => {
  // Vitest would load such a file and report zero tests rather than fail.
  assert.deepEqual(
    facts.filter((file) => file.importsNodeTest).map((file) => file.path),
    [],
    'Import test/describe/it from "vitest" instead of "node:test".',
  );
});

test("every test file registers at least one named test", () => {
  // The seven module-level assertion files this migration named. A file that
  // registers nothing reports nothing, so an assertion added to it is invisible.
  assert.deepEqual(
    facts.filter((file) => file.registrations === 0).map((file) => file.path),
    [],
    "Wrap the assertions in a named test() so the runner reports them.",
  );
});

test("nothing is quarantined with .only, .skip or .todo", () => {
  // A skipped test is a test nobody is watching. With three people and no
  // on-call, the first sign of a skipped print check is a client asking why
  // their PDF has an extra page.
  assert.deepEqual(
    facts
      .filter((file) => file.modifiers.length > 0)
      .map((file) => `${file.path}: ${file.modifiers.join(", ")}`),
    [],
    "Fix or delete the test rather than hiding its result.",
  );
});

test("every file that launches a browser is in the print project", () => {
  // The config's own list is the one read above, so the two cannot disagree.
  // What it cannot tell you is whether that list is COMPLETE. If a third file
  // starts launching Chromium without
  // being added, CI — which sets PUPPETEER_SKIP_DOWNLOAD and installs no
  // browser — is where it fails, and the error names a missing executable
  // rather than the test that wanted one.
  const launchers = facts
    .filter((file) =>
      /\bpuppeteer(-core)?\b/.test(readFileSync(join(ROOT, file.path), "utf8")),
    )
    .map((file) => file.path);

  assert.deepEqual(launchers, printTests);
});

test("the print project names real test files, and at least one", () => {
  assert.ok(printTests.length > 0, "the print project cannot be empty");

  for (const file of printTests) {
    assert.ok(
      facts.some((fact) => fact.path === file),
      `${file} is in the print project but is not a test file`,
    );
  }
});

test("the CI lane is the unit project, and never the print one", () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    .scripts as Record<string, string>;
  assert.equal(scripts["test:unit"], "vitest run --project unit");
  assert.equal(scripts["test:print"], "vitest run --project print");
  assert.ok(
    !Object.values(scripts).some((command) => command.includes("tsx --test")),
    "no test script may invoke the retired runner",
  );

  const workflow = readFileSync(
    join(ROOT, ".github", "workflows", "quality.yml"),
    "utf8",
  );
  assert.match(workflow, /run: pnpm test:unit/);
  // A comment may explain the print lane; a `run:` step may not invoke it.
  assert.doesNotMatch(
    workflow,
    /run: pnpm test:print/,
    "CI installs no browser, so the print lane must stay explicit and local.",
  );
});
