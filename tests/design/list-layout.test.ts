import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { REPO_ROOT } from "../support/repo-root";

// The owner wants every list to look like Leads: the toolbar on the page
// (components/common/list-toolbar.tsx), then one TableCard holding the table.
// A Card or SectionCard around a list was the "outer card" they asked to lose.

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const PAGE_LISTS: { name: string; toolbar: string; card: string }[] = [
  {
    name: "Projects",
    toolbar: "components/projects/project-toolbar.tsx",
    card: "components/projects/projects-client.tsx",
  },
  {
    name: "Offers",
    toolbar: "components/offers/offer-filter.tsx",
    card: "components/offers/offer-filter.tsx",
  },
  {
    name: "Tradies",
    toolbar: "components/tradie-management/tradie-tabs.tsx",
    card: "components/tradie-management/tradie-body.tsx",
  },
  {
    name: "Approvals",
    toolbar: "components/tradie-approvals/tradie-approval-tabs.tsx",
    card: "components/tradie-approvals/tradie-approval-client.tsx",
  },
  {
    name: "Trade types",
    toolbar: "components/admin/trade-types-admin.tsx",
    card: "components/admin/trade-types-admin.tsx",
  },
];

for (const list of PAGE_LISTS) {
  test(`${list.name} puts its toolbar on the page and its table in one TableCard`, () => {
    assert.ok(read(list.toolbar).includes("<ListToolbar"), "no ListToolbar");
    const card = read(list.card);
    assert.ok(card.includes("<TableCard"), "no TableCard");
    assert.ok(!card.includes("<SectionCard"), "a SectionCard wraps the list");
  });
}

test("the Offers page draws no card around its list", () => {
  assert.ok(!/<Card\b/.test(read("app/(main)/offers/page.tsx")));
});

test("list search fields are the shared ToolbarSearch", () => {
  for (const path of [
    "components/projects/project-toolbar.tsx",
    "components/offers/offer-filter.tsx",
    "components/tradie-management/tradie-tabs.tsx",
    "components/tradie-approvals/tradie-approval-tabs.tsx",
    "app/(main)/admin/manage-team/page.tsx",
  ]) {
    assert.ok(
      read(path).includes("<ToolbarSearch"),
      `${path} hand-rolls search`,
    );
  }
});
