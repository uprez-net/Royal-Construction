import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// Issue #457. cmdk's <CommandList> is always role="listbox". A listbox that
// holds only "No results found." or "Loading..." has no option children, and
// axe reports it as a critical aria-required-children failure, in exactly the
// two states a screen-reader user meets while searching. The text lives AFTER
// the list instead; cmdk's Empty reads the Command context, so it still shows
// and hides itself there. This pins it, because the failure shows only with an
// open menu and no rows, which no one looks at in review.

const files = execSync("git ls-files 'components/**/*.tsx' 'app/**/*.tsx'", {
  cwd: REPO_ROOT,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((file) => file !== "components/ui/command.tsx");

test("no CommandEmpty is rendered inside a CommandList", () => {
  // A glob that matched nothing would pass forever.
  assert.ok(
    files.includes("components/common/searchable-select.tsx"),
    "the file list no longer finds the components",
  );
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const list of source.matchAll(
      /<CommandList\b[\s\S]*?<\/CommandList>/g,
    )) {
      if (list[0].includes("<CommandEmpty")) offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Move <CommandEmpty> after </CommandList> (see CommandEmpty in components/ui/command.tsx)",
  );
});
