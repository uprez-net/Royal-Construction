import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PAGE_HEADER_CLASS, PageHeader } from "@/components/common/page-header";
import { REPO_ROOT } from "../support/repo-root";

// /offers streams its skeleton first, then swaps in PageHeader. When the two
// headers were laid out differently (a flat tint with p-6 against a gradient
// card with 40px of padding) the page flashed and jumped on the swap. The
// header now sits on the page background with no card, and the skeleton must
// do the same.

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const SKELETONS = [
  "app/(main)/offers/loading.tsx",
  "app/(main)/admin/offer-content/loading.tsx",
];

const SURFACE = /^(bg-|border|shadow|rounded|p[xytrbl]?-)/;

test("the page header paints no card surface", () => {
  const markup = renderToStaticMarkup(
    createElement(PageHeader, {
      title: "Offers",
      description: "Offers",
      headingLevel: "h1",
    }),
  );
  assert.ok(!markup.includes('data-slot="card"'), "PageHeader renders a Card");
  const classes = markup.match(/<header class="([^"]+)"/)?.[1]?.split(/\s+/);
  assert.deepEqual(classes, PAGE_HEADER_CLASS.split(/\s+/));
  for (const name of classes) {
    assert.ok(!SURFACE.test(name), `PageHeader paints a surface: ${name}`);
  }
});

for (const path of SKELETONS) {
  test(`${path} lays its header out like PageHeader`, () => {
    const source = read(path);
    const header = source.indexOf("className={PAGE_HEADER_CLASS}");
    assert.ok(
      header !== -1,
      "the skeleton header does not use PAGE_HEADER_CLASS",
    );
    // Nothing before the header may draw the old gold hero card.
    assert.ok(
      !source.slice(0, header).includes("border-royal-gold"),
      "the skeleton still paints the old hero card",
    );
  });
}

// The figures under the header are one KpiBand, and so are their skeletons;
// a skeleton still drawing separate tiles would jump on the swap the same way.
test("the KPI rows and their skeletons are KpiBands", () => {
  for (const path of [
    "components/offers/offer-kpi.tsx",
    "app/(main)/offers/loading.tsx",
    "components/dashboard/dashboard-kpi.tsx",
    "app/(main)/dashboard/loading.tsx",
    "components/leads/leads.tsx",
    "components/leads/leads-page-skeleton.tsx",
  ]) {
    assert.ok(read(path).includes("<KpiBand"), `${path} does not use KpiBand`);
  }
});
