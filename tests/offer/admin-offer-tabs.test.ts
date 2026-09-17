import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferContentHeader } from "../../components/offers/admin/offer-content-header";
import {
  ADMIN_OFFER_TABS,
  TAB_SECTION,
  dirtyByTab,
  type AdminOfferTabs,
} from "../../components/offers/admin/offer-content-tabs";

// The admin tab strip ticked every tab to the left of the one you clicked, so
// opening HBCF Claim showed five "complete" sections nobody had saved, while an
// unsaved edit vanished from view as soon as you changed tab. A tab is now
// marked only when the slice's dirty flag for the section it saves is set.
//
// The strip also put aria-current on a decorative span and named every button
// "Jump to …", so a screen reader never heard which tab was open. The render
// tests below pin both halves in the header itself, not just the mapping.

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

const noneDirty = dirtyByTab(allSaved);

const renderStrip = (
  activeTab: AdminOfferTabs,
  dirtyTabs: Record<AdminOfferTabs, boolean> = noneDirty,
) =>
  renderToStaticMarkup(
    createElement(OfferContentHeader, {
      activeTab,
      onTabChange: () => {},
      dirtyTabs,
    }),
  );

const buttonsOf = (markup: string) =>
  markup.match(/<button\b[\s\S]*?<\/button>/g) ?? [];

const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

// What a screen reader names the button: its text, minus aria-hidden subtrees.
const accessibleNameOf = (button: string) =>
  textOf(button.replace(/<div\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/div>/g, ""));

test("opening the last tab ticks nothing and numbers the tabs before it", () => {
  const markup = renderStrip("HBFC-claim");
  const buttons = buttonsOf(markup);

  assert.equal(buttons.length, ADMIN_OFFER_TABS.length);
  assert.doesNotMatch(markup, /<svg\b/, "no tab carries a tick icon");
  ADMIN_OFFER_TABS.forEach((tab, index) => {
    const expected =
      tab.id === "HBFC-claim" ? tab.label : `${index + 1}${tab.label}`;
    assert.equal(textOf(buttons[index]), expected);
  });
});

// These buttons switch a panel rendered in place, so they are tabs, not links:
// aria-current said "this is where you are" without telling anyone that the
// thing beside it is what the tab controls.
test("exactly one tab is selected, and it is the open one", () => {
  const markup = renderStrip("cost-schedule");
  const buttons = buttonsOf(markup);

  assert.match(markup, /role="tablist"/);
  assert.equal(markup.match(/aria-selected="true"/g)?.length, 1);
  assert.doesNotMatch(markup, /aria-current=/);
  assert.match(buttons[1], /^<button\b[^>]*aria-selected="true"/);
  for (const button of buttons) {
    assert.match(button, /^<button\b[^>]*role="tab"/);
    assert.doesNotMatch(button, /^<button\b[^>]*aria-label=/);
  }
  assert.equal(accessibleNameOf(buttons[1]), "Cost Schedule");
});

// Only the open tab is in the tab order: Tab reaches the strip once and the
// arrows move within it.
test("the strip has a single tab stop", () => {
  const buttons = buttonsOf(renderStrip("cost-schedule"));

  assert.equal(
    buttons.filter((button) => /tabindex="0"/i.test(button)).length,
    1,
    "every tab should be skipped by Tab except the open one",
  );
});

test("each tab names the panel it controls", () => {
  const markup = renderStrip("cost-schedule");
  const buttons = buttonsOf(markup);

  ADMIN_OFFER_TABS.forEach((tab, index) => {
    assert.match(buttons[index], new RegExp(`id="admin-offer-tab-${tab.id}"`));
    assert.match(
      buttons[index],
      new RegExp(`aria-controls="admin-offer-panel-${tab.id}"`),
    );
  });
});

test("an unsaved section is announced only on its own tab", () => {
  const buttons = buttonsOf(
    renderStrip("job-setup", { ...noneDirty, "cost-schedule": true }),
  );

  assert.deepEqual(buttons.map(accessibleNameOf), [
    "Job Setup",
    "Cost Schedule, unsaved changes",
    "Scope",
    "Inclusions",
    "Offer Document",
    "HBCF Claim",
  ]);
});
