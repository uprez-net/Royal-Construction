import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeLeadPage,
  pageAfterQueryChange,
  shownSelection,
} from "../../lib/leads/lead-search-paging";

// The lead picker never went back to page 1 when the search changed. After
// scrolling to page 3, typing a name requested page 3 of the matches and
// appended it to the unfiltered leads already on screen, so the list showed
// leads that did not match the search at all.

const lead = (id: number) => ({ id, name: `Lead ${id}` });

test("page 1 replaces the list", () => {
  const onScreen = [lead(1), lead(2), lead(3)];
  const matches = [lead(7)];
  assert.deepEqual(mergeLeadPage(onScreen, matches, 1), [lead(7)]);
});

test("a later page appends without repeating a lead already shown", () => {
  const onScreen = [lead(1), lead(2)];
  const next = [lead(2), lead(3)];
  assert.deepEqual(mergeLeadPage(onScreen, next, 2), [lead(1), lead(2), lead(3)]);
});

test("the same search keeps the scrolled-to page", () => {
  assert.equal(pageAfterQueryChange("", "", 2), 2);
  assert.equal(pageAfterQueryChange("Smith", "Smith ", 3), 3);
});

test("a different search starts again from page 1", () => {
  assert.equal(pageAfterQueryChange("", "Smith", 2), 1);
  assert.equal(pageAfterQueryChange("Smith", "", 4), 1);
});

// A new search hid the chosen lead but kept it chosen, so Open Offer Workspace
// stayed enabled and opened (creating an Offer row for) a lead no longer shown.
test("a chosen lead counts only while its card is shown", () => {
  const shown = [lead(1), lead(2)];
  assert.equal(shownSelection(2, shown, false), 2);
  assert.equal(shownSelection(3, shown, false), null);
  assert.equal(shownSelection(2, shown, true), null);
  assert.equal(shownSelection(null, shown, false), null);
});
