import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The lead picker's rules are tested in lead-search-paging.test.ts, but these
// bugs lived in the files that use them: a client hook and client components
// that load React, so no test can import them. This reads the source instead.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const cards = read("components/offers/lead-card-list.tsx");

test("the lead cards' keyboard focus ring is not cancelled by outline-none", () => {
  // In Tailwind 4, outline-none sets --tw-outline-style to none and
  // focus-visible:outline-2 reads that variable. Cards with both classes never
  // showed focus, so a keyboard user could not see which lead Space would pick.
  assert.match(cards, /focus-visible:outline-2/);
  assert.doesNotMatch(cards, /"[^"\n]*\boutline-none\b[^"\n]*"/);
});
