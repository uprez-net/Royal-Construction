import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Browser } from "puppeteer";

import {
  companyOwner,
  declaredPageTotal,
  individualOwner,
  scheduleOf,
  tenderFor,
} from "./tender-fixtures";

// Tender parity assertions that need a REAL browser: page geometry measured off
// laid-out boxes, computed table styles, and the page-count truth check that
// renders an actual PDF.
//
// Kept apart from offer-tender-template-parity.test.ts (which asserts the same
// document from its HTML alone and runs everywhere) because CI sets
// PUPPETEER_SKIP_DOWNLOAD and never installs Chrome. This file is therefore
// excluded from `test:unit` alongside offer-document-print-pages.test.ts — see
// the note in package.json and .github/workflows/main.yml.
//
// It fails loudly rather than skipping when Chrome is missing: a silently
// skipped print test is how the "footer says 10, prints 11" class of bug
// survived a review round. Run it locally before shipping a change to
// offer-tender-html.ts:
//
//   npx tsx --test tests/offer/offer-tender-print-parity.test.ts
//
// Every measurement below was read out of the Word template's OOXML — they are
// measurements, not preferences.

const A4 = { format: "A4" as const, printBackground: true };
const MM_PER_PX = 25.4 / 96;
const TOLERANCE_MM = 0.3;

// One browser for the whole file: each launch costs ~1s and this file renders a
// lot of documents.
let shared: Browser | null = null;
async function browser(): Promise<Browser> {
  if (!shared) {
    const puppeteer = (await import("puppeteer")).default;
    shared = await puppeteer.launch({ headless: true });
  }
  return shared;
}
after(async () => {
  await shared?.close();
  shared = null;
});

async function withPage<T>(
  html: string,
  fn: (page: import("puppeteer").Page) => Promise<T>,
): Promise<T> {
  const page = await (await browser()).newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function printedPageCount(html: string): Promise<number> {
  return withPage(html, async (page) => {
    const pdf = await page.pdf(A4);
    const text = Buffer.from(pdf).toString("latin1");
    return (text.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
  });
}

// ─── Step 2 + 3: geometry and table construction ────────────────────────────

test("page margins and table geometry match the template to ±0.3mm", async () => {
  const html = tenderFor([individualOwner(1)]);
  const measured = await withPage(html, (page) =>
    page.evaluate(() => {
      const pageEl = document.querySelector(".page") as HTMLElement;
      const body = pageEl.querySelector(".page-body") as HTMLElement;
      // The first schedule table is the one whose columns are specified.
      const table = Array.from(document.querySelectorAll("table")).find((t) =>
        t.querySelector("th.c-ref"),
      ) as HTMLTableElement;
      const cells = Array.from(
        table.querySelectorAll("thead th"),
      ) as HTMLElement[];
      const pageBox = pageEl.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      return {
        pageWidth: pageBox.width,
        leftMargin: bodyBox.left - pageBox.left,
        rightMargin: pageBox.right - bodyBox.right,
        tableWidth: table.getBoundingClientRect().width,
        columns: cells.map((c) => c.getBoundingClientRect().width),
      };
    }),
  );
  const mm = (px: number) => px * MM_PER_PX;
  const near = (actual: number, expected: number, what: string) =>
    assert.ok(
      Math.abs(actual - expected) <= TOLERANCE_MM,
      `${what}: expected ${expected}mm ±${TOLERANCE_MM}, got ${actual.toFixed(3)}mm`,
    );

  near(mm(measured.pageWidth), 210, "A4 sheet width");
  near(mm(measured.leftMargin), 15.875, "left margin (pgMar 900 twips)");
  near(mm(measured.rightMargin), 15.875, "right margin (pgMar 900 twips)");
  near(mm(measured.tableWidth), 178.25, "content width (10106 twips)");
  assert.equal(measured.columns.length, 3, "schedule is three columns");
  near(mm(measured.columns[0]), 15.88, "Ref column (900 twips)");
  near(mm(measured.columns[1]), 127.11, "Description column (7206 twips)");
  near(mm(measured.columns[2]), 35.28, "Status column (2000 twips)");
});

test("table construction matches the template", async () => {
  const html = tenderFor([individualOwner(1)]);
  // NOTE: every helper here is an inline arrow argument, never a const-assigned
  // function. tsx compiles the latter with esbuild's keepNames, which injects a
  // `__name` call that does not exist inside the browser context.
  const measured = await withPage(html, (page) =>
    page.evaluate(() => {
      const table = Array.from(document.querySelectorAll("table")).find((t) =>
        t.querySelector("th.c-ref"),
      ) as HTMLTableElement;
      const rows = Array.from(
        table.querySelectorAll("tbody tr"),
      ) as HTMLElement[];
      return [
        table.querySelector("th") as HTMLElement | null,
        rows[0] ? (rows[0].querySelector("td") as HTMLElement) : null,
        rows[1] ? (rows[1].querySelector("td") as HTMLElement) : null,
      ].map((el) =>
        el
          ? {
              background: getComputedStyle(el).backgroundColor,
              color: getComputedStyle(el).color,
              padTop: getComputedStyle(el).paddingTop,
              padRight: getComputedStyle(el).paddingRight,
              padBottom: getComputedStyle(el).paddingBottom,
              padLeft: getComputedStyle(el).paddingLeft,
            }
          : null,
      );
    }),
  );
  const styles = {
    header: measured[0]!,
    firstRow: measured[1]!,
    secondRow: measured[2],
  };
  // Gold header row, white bold text.
  assert.equal(
    styles.header.background,
    "rgb(200, 169, 81)",
    "header fill #C8A951",
  );
  assert.equal(styles.header.color, "rgb(255, 255, 255)", "header text white");
  // Zebra restarts in every table and the FIRST data row is white.
  assert.equal(
    styles.firstRow.background,
    "rgb(255, 255, 255)",
    "row 1 is white",
  );
  if (styles.secondRow) {
    assert.equal(
      styles.secondRow.background,
      "rgb(242, 242, 242)",
      "row 2 is the #F2F2F2 zebra stripe",
    );
  }
  // Asymmetric padding: 4/4/4/6pt (tcMar 80/80/80/120 twips). 1pt = 4/3 px.
  const pt = (value: string) => Number(value.replace("px", "")) * 0.75;
  assert.ok(Math.abs(pt(styles.firstRow.padTop) - 4) < 0.1, "4pt top padding");
  assert.ok(
    Math.abs(pt(styles.firstRow.padRight) - 4) < 0.1,
    "4pt right padding",
  );
  assert.ok(
    Math.abs(pt(styles.firstRow.padBottom) - 4) < 0.1,
    "4pt bottom padding",
  );
  assert.ok(
    Math.abs(pt(styles.firstRow.padLeft) - 6) < 0.1,
    "6pt left padding",
  );
});

// ─── Step 5: page-count truth ───────────────────────────────────────────────

test("the footer's page total equals the sheets Chromium actually prints", async () => {
  const signerCounts = [1, 2, 5, 10];
  const scheduleSizes = [0, 1, 30, 120];
  for (const signers of signerCounts) {
    for (const size of scheduleSizes) {
      const owners = Array.from({ length: signers }, (_, i) =>
        individualOwner(i + 1),
      );
      const html = tenderFor(owners, scheduleOf(size));
      const declared = declaredPageTotal(html);
      const printed = await printedPageCount(html);
      assert.equal(
        printed,
        declared,
        `${signers} signer(s), ${size} inclusions: printed ${printed} sheets but declared ${declared}`,
      );
    }
  }
});

test("company signers paginate the acceptance table truthfully", async () => {
  for (const owners of [
    [companyOwner(1, 10)],
    Array.from({ length: 10 }, (_, i) => companyOwner(i + 1, 1)),
    Array.from({ length: 5 }, (_, i) => companyOwner(i + 1, 2)),
  ]) {
    const html = tenderFor(owners);
    assert.equal(
      await printedPageCount(html),
      declaredPageTotal(html),
      `acceptance pagination is untruthful for ${owners.length} company owner(s)`,
    );
  }
});

test("no acceptance row is split across a page boundary", async () => {
  const owners = Array.from({ length: 10 }, (_, i) => companyOwner(i + 1, 1));
  const html = tenderFor(owners);
  const overflowing = await withPage(html, (page) =>
    page.evaluate(() => {
      const limit = 297 * (96 / 25.4);
      return Array.from(document.querySelectorAll(".page"))
        .map((el, i) => ({ i: i + 1, h: (el as HTMLElement).scrollHeight }))
        .filter((p) => p.h > limit + 1);
    }),
  );
  assert.deepEqual(
    overflowing,
    [],
    `pages overflow their A4 box: ${JSON.stringify(overflowing)}`,
  );
});
