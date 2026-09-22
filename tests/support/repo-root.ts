import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root, resolved from this file's own location.
 *
 * Around sixty tests read repository source rather than importing it — the
 * source-contract checks that assert a route still passes an idempotency key,
 * that an adapter still surfaces a domain refusal, that a "use server" module
 * still authorizes its caller. They need a root that does not depend on how the
 * runner was invoked:
 *
 *   * `__dirname` is a CommonJS global. Vitest transforms these files to ESM,
 *     where it does not exist.
 *   * `process.cwd()` is whatever directory the command was typed in.
 *
 * `import.meta.url` is neither: it is this file, so the root is the same
 * whether the suite runs from the repository root, from an editor, or from a
 * Vitest worker.
 */
export const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
