import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADMIN_OFFER_TABS,
  TAB_SECTION,
  dirtyByTab,
} from "../../components/offers/admin/offer-content-tabs";

// The admin tab strip ticked every tab to the left of the one you clicked, so
// opening HBCF Claim showed five "complete" sections nobody had saved, while an
// unsaved edit vanished from view as soon as you changed tab. A tab is now
// marked only when the slice's dirty flag for the section it saves is set.

const allSaved = {
  buildScope: false,
  costSchedule: false,
  offerScope: false,
  offerContent: false,
  hbfcClaim: false,
};

const markedTabs = (marks: Record<string, boolean>) =>
  Object.entries(marks)
    .filter(([, dirty]) => dirty)
    .map(([id]) => id)
    .sort();

test("every tab the strip renders is mapped to the section it saves", () => {
  const tabIds = ADMIN_OFFER_TABS.map((tab) => tab.id).sort();
  assert.deepEqual(Object.keys(TAB_SECTION).sort(), tabIds);
  for (const id of tabIds) {
    assert.ok(TAB_SECTION[id], `${id} has no section`);
  }
});

test("no tab is marked while every section is saved", () => {
  const marks = dirtyByTab(allSaved);
  assert.deepEqual(
    Object.keys(marks).sort(),
    ADMIN_OFFER_TABS.map((tab) => tab.id).sort(),
  );
  assert.deepEqual(markedTabs(marks), []);
});

test("an unsaved cost schedule marks only the Cost Schedule tab", () => {
  assert.deepEqual(markedTabs(dirtyByTab({ ...allSaved, costSchedule: true })), [
    "cost-schedule",
  ]);
});

test("unsaved offer content marks both screens that edit it", () => {
  assert.deepEqual(markedTabs(dirtyByTab({ ...allSaved, offerContent: true })), [
    "offer-content",
    "offer-inclusions",
  ]);
});
