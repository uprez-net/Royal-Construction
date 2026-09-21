import assert from "node:assert/strict";
import { join, relative } from "node:path";
import { test } from "node:test";

import { ROOT, collectSourceFiles, walkGraph } from "./module-graph";

// The test suite runs under `tsx --test`, which is plain Node. `server-only`
// throws the moment it is imported outside a React bundler, so a test that
// imports anything transitively reaching a `server-only` module does not fail
// with an assertion — it dies loading, taking the whole file with it.
//
// That is how `tests/offer/admin-guard.test.ts` went down: issue #301 added
// `import "server-only"` to `lib/data/user.ts`, which `lib/auth/require-admin.ts`
// imported for one lookup, which the test imported for one pure function. The
// crash names `server-only/index.js`, not the edge that caused it, so this
// test exists to name the edge instead. `lib/auth/require-admin.ts` now
// resolves through the Node-safe `lib/domain/identity/users.ts`, as `proxy.ts`
// already did.
//
// This is the same class the Eve package boundary guards on the agent side,
// asked of the test suite: can Node actually load what these files import?

const SERVER_ONLY = new Set(["server-only", "client-only"]);

test("no test imports a module that throws when Node loads it", () => {
  const entryFiles = collectSourceFiles(join(ROOT, "tests")).filter((file) =>
    file.endsWith(".test.ts"),
  );
  assert.ok(entryFiles.length > 0, "no test files were found to walk");

  const { violations } = walkGraph({
    entryFiles,
    forbiddenPackage: (specifier) => SERVER_ONLY.has(specifier),
  });

  assert.deepEqual(
    violations.map((violation) => `${violation.chain.join(" → ")} → ${violation.specifier}`),
    [],
    'A test reaches a module that imports "server-only", which throws under tsx --test. Move the part the test needs behind a Node-safe module (lib/domain/**), or have the test read the source instead of importing it.',
  );
});

test("the walk it relies on can actually see a server-only edge", () => {
  // Proof the check is not vacuous: pointed at an adapter that does carry the
  // directive, it finds it. Without this, a walk that silently resolved
  // nothing would pass for ever.
  const probe = join(ROOT, "lib", "data", "user.ts");
  const { violations } = walkGraph({
    entryFiles: [probe],
    forbiddenPackage: (specifier) => SERVER_ONLY.has(specifier),
  });
  assert.equal(
    violations.length,
    1,
    `expected ${relative(ROOT, probe)} to report its own server-only import`,
  );
});
