// The SQL JSON reads (issue #411) build their result in Postgres instead of
// through a Prisma include, but the include is still their contract: it types
// the result. The risk is drift — a relation or a field added to the include
// and not to the SQL is simply missing on the screen, with no error. So every
// key the include names must appear as a JSON key in the SQL. This cannot
// prove the two agree (the compare scripts in scripts/perf diff real results
// for that); it stops the change that forgot the other half.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./repo-root";

export const source = (path: string) =>
  readFileSync(join(REPO_ROOT, path), "utf8");

/** Every relation and selected field an include or select names. */
function namedKeys(args: unknown, path: string[] = []): string[][] {
  if (!args || typeof args !== "object") return [];
  const node = args as Record<string, unknown>;
  const fields = (node.include ?? node.select ?? node) as Record<
    string,
    unknown
  >;
  const keys: string[][] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (
      key === "orderBy"
      || key === "where"
      || key === "take"
      || value === false
    ) {
      continue;
    }
    keys.push([...path, key]);
    if (value && typeof value === "object") {
      keys.push(...namedKeys(value, [...path, key]));
    }
  }
  return keys;
}

/** The include's keys, as dotted paths, that the SQL never names. */
export function missingFrom(sql: string, args: unknown, skip: string[] = []) {
  return namedKeys(args)
    .filter((path) => !skip.includes(path[0]))
    .filter((path) => !sql.includes(`'${path.at(-1)}'`))
    .map((path) => path.join("."));
}
