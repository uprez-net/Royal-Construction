import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The lead picker's rules are tested in lead-search-paging.test.ts, but these
// bugs lived in the files that use them: a client hook and client components
// that load React, so no test can import them. This reads the source instead.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const cards = read("components/offers/lead-card-list.tsx");
const hook = read("hooks/useLeadSearch.ts");

// Undoing any of the three below kept every rule test green. Before, the hook
// never reset the page on a new search, so after scrolling to page 3 typing a
// name fetched page 3 of the matches and appended it to the unfiltered leads.

test("a new search resets the page through pageAfterQueryChange", () => {
  const start = hook.indexOf("const setQuery = useCallback(");
  assert.ok(start >= 0, "setQuery is not a useCallback in useLeadSearch");
  const setQuery = hook.slice(start, hook.indexOf("}, []);", start));
  assert.match(
    setQuery,
    /setPageInfo\(\(prev\) => \{[\s\S]*pageAfterQueryChange\(/,
  );
});

test("every fetched page is folded in by mergeLeadPage", () => {
  assert.match(
    hook,
    /setItems\(\(prev\) => mergeLeadPage\(prev, data\.items, page\)\)/,
  );
});

test("the fetch reruns on a search or page change, not when the list grows", () => {
  assert.match(hook, /\}, \[searchTerm, page, getLeadsWithoutProject\]\);/);
  assert.doesNotMatch(hook, /\[[^\]]*\bitems\.length\b[^\]]*\]\);/);
});

test("a response that lands after the search changed is dropped", () => {
  // setQuery runs from the picker's effect, so a page response could land
  // between the reset to page 1 and the abort, write its old page number back,
  // and have the new search fetch that page under the old list.
  assert.match(
    hook,
    /const superseded = \(\) =>\s*controller\.signal\.aborted \|\| queryRef\.current\.trim\(\) !== searchTerm;/,
  );
  const success = hook.slice(
    hook.indexOf("await fetchJson"),
    hook.indexOf("setItems("),
  );
  assert.match(success, /if \(superseded\(\)\) return;/);
  assert.match(hook, /catch \(err\) \{[\s\S]*?if \(superseded\(\)\) return;/);
  assert.match(hook, /finally \{[\s\S]*?if \(!superseded\(\)\) \{/);
});

test("the empty-state copy goes by the search the results came from", () => {
  // It read the input box, which runs ahead of the results: clearing a search
  // that matched nothing showed and announced "No leads are ready for an
  // offer." until the full list loaded.
  assert.match(
    hook,
    /setPageInfo\(\{[\s\S]*?\}\);\s*setResultQuery\(searchTerm\);/,
  );
  for (const path of [
    "components/offers/create-offer-modal.tsx",
    "components/projects/create-project-modal.tsx",
  ]) {
    const modal = read(path);
    assert.match(modal, /emptyMessage=\{\s*leadSearch\.resultQuery\s*\?/, path);
    assert.doesNotMatch(modal, /emptyMessage=\{\s*search\./, path);
  }
});

test("confirming uses the chosen lead only while its card is shown", () => {
  // A search hid the chosen lead but Open Offer Workspace stayed enabled and
  // opened it, creating an Offer row for a lead the user could not see.
  const offer = read("components/offers/create-offer-modal.tsx");
  assert.match(
    offer,
    /const chosenLeadId = shownSelection\(\s*selectedLeadId,\s*leadSearch\.items,\s*leadSearch\.loading,?\s*\)/,
  );
  assert.match(offer, /disabled=\{!chosenLeadId\}/);
  assert.match(offer, /router\.push\(`\/offers\/\$\{chosenLeadId\}`\)/);

  const project = read("components/projects/create-project-modal.tsx");
  const start = project.indexOf("const handleExtract = async () => {");
  assert.ok(start >= 0, "handleExtract not found in create-project-modal");
  const guard = project.slice(start, project.indexOf("return;", start));
  assert.match(
    guard,
    /shownSelection\(selectedLeadId, leadSearch\.items, leadSearch\.loading\)/,
  );
  assert.match(guard, /if \(!selectedLeadId \|\| !shownLeadId\)/);
});

test("the no-leads message is announced from a live region that outlives the skeleton", () => {
  // The only role=status used to arrive with its text already in it when the
  // skeleton swapped out, and screen readers often skip a region like that.
  assert.equal(cards.match(/role="status"/g)?.length, 1);
  assert.match(cards, /const liveRegion = \(\s*<p role="status"/);
  assert.match(
    cards,
    /if \(loading\) \{\s*return \(\s*<>\s*\{liveRegion\}\s*<LeadCardListSkeleton/,
  );
  assert.match(
    cards,
    /return \(\s*<>\s*\{liveRegion\}\s*<div ref=\{scrollContainerRef\}/,
  );
});

test("the lead cards' keyboard focus ring is not cancelled by outline-none", () => {
  // In Tailwind 4, outline-none sets --tw-outline-style to none and
  // focus-visible:outline-2 reads that variable. Cards with both classes never
  // showed focus, so a keyboard user could not see which lead Space would pick.
  assert.match(cards, /focus-visible:outline-2/);
  assert.doesNotMatch(cards, /"[^"\n]*\boutline-none\b[^"\n]*"/);
});
