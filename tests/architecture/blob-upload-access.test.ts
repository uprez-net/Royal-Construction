import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

/**
 * Every Blob write goes to a store created private (#571), and Vercel refuses
 * a public write to a private store outright. In the browser that refusal of a
 * streamed upload surfaces only as "Failed to fetch (vercel.com)": the
 * compliance tab's uploads (the CDC, HBCF cover, checklist rows, thread
 * attachments) failed that way in production because one hook still asked for
 * public access after the migration.
 *
 * A source file that writes with public access is listed here with the reason
 * it is known to be broken, so the next one is a test failure, not a toast.
 */
const KNOWN_PUBLIC_WRITES: Record<string, string> = {
  // The ad-hoc email composer puts the uploaded URL into an email to a lead as
  // a link, so a private object would arrive as a link nobody outside can open.
  // It needs its own answer (a public store, or a signed public route), not a
  // one-word change; until then it fails loudly with "Failed to upload file".
  "hooks/use-email-ad-hock.ts":
    "emailed attachment links need public reads; see the comment above",
};

const SCANNED = ["app", "components", "hooks", "lib", "agent", "utils"];
const PUBLIC_ACCESS = /access:\s*["']public["']/;

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield path;
    }
  }
}

test("no Blob write asks for public access on the private store", () => {
  const offenders: string[] = [];
  for (const root of SCANNED) {
    for (const path of sourceFiles(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, path).replaceAll("\\", "/");
      if (rel in KNOWN_PUBLIC_WRITES) continue;
      if (PUBLIC_ACCESS.test(readFileSync(path, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});
