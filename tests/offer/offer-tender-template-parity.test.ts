import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Browser } from "puppeteer";

import { buildContractSignatureAnnexureHtml } from "../../lib/offer/contract-annexure-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import {
  amountInWords,
  buildTenderHtml,
  money,
} from "../../lib/offer/offer-tender-html";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
  collectOfferSigners,
  createCompanyOwner,
  createIndividualOwner,
  createOfferSignatory,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferInclusionEntry,
  type OfferOwner,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";

// Parity harness for the Royal Constructions Word tender template. Every number
// asserted here was read out of that .docx's OOXML (word/document.xml,
// word/styles.xml, word/header1.xml, word/footer1.xml) — they are measurements,
// not preferences, so a failure here means the document drifted off the
// template, not that the tolerance is too tight.
//
// Byte-identical parity with Word's renderer is not achievable from Chromium
// (the two disagree on Arial line-breaking and row-height rounding). What is
// asserted is token parity, geometry parity to ±0.3mm, and — the two that will
// catch a real regression months from now — anchor integrity and page-count
// truth.

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

function snapshotOf(
  owners: OfferOwner[],
  schedule?: readonly OfferInclusionEntry[],
): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB, owners },
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: schedule
      ? { ...INITIAL_OFFER_DRAFT, inclusionSchedule: schedule }
      : INITIAL_OFFER_DRAFT,
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: 0,
    areaCalculator: INITIAL_AREA_CALCULATOR,
    workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    rateCardProduct: "DOUBLE_STOREY",
    rateCardTier: "MID",
    overrideReason: "",
    selectedPriceInput: "",
    standardPriceInput: "",
    priceAdjustmentLabel: "",
    images: EMPTY_OFFER_IMAGES,
  } as unknown as OfferWorkspaceSnapshot;
}

function individualOwner(index: number): OfferOwner {
  const base = createIndividualOwner(`owner-${index}`);
  return {
    ...base,
    displayName: `Owner Number ${index}`,
    currentLocation: `${index} Somewhat Long Street Name, Sydney NSW 2000`,
    signatories: [
      {
        ...base.signatories[0],
        name: `Owner Number ${index}`,
        email: `owner${index}@example.com`,
        phone: "0400 000 000",
      },
    ],
  };
}

function companyOwner(index: number, directors: number): OfferOwner {
  const base = createCompanyOwner(`company-${index}`);
  return {
    ...base,
    displayName: `Kensington Grove Property No ${index} Pty Ltd`,
    abn: `12 345 678 ${String(900 + index).slice(0, 3)}`,
    currentLocation: `Level ${index}, 100 Somewhat Long Street, Sydney NSW 2000`,
    signatories: Array.from({ length: directors }, (_, d) => ({
      ...createOfferSignatory(`company-${index}-dir-${d}`, "Director"),
      name: `Director Number ${d + 1} of Company ${index}`,
      email: `dir${d + 1}.co${index}@example.com`,
      phone: "0400 000 000",
    })),
  };
}

function scheduleOf(n: number): OfferInclusionEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    category: `Trade Label ${i + 1}`,
    spec: `Specification detail for row ${i + 1}. Supply and install in accordance with the approved plans.`,
  }));
}

function tenderFor(
  owners: OfferOwner[],
  schedule?: readonly OfferInclusionEntry[],
): string {
  return buildTenderHtml(buildProposalInput(snapshotOf(owners, schedule)));
}

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

function declaredPageTotal(html: string): number {
  const match = html.match(/Page \d+ of (\d+)/);
  assert.ok(match, "document declares no page total");
  return Number(match[1]);
}

// ─── Step 1: token audit ────────────────────────────────────────────────────

// Every one of these belonged to the pre-restyle tender. A hit means a rule or a
// literal survived the fork and is still reaching the printed tender.
test("no pre-restyle token survives in the tender", () => {
  const html = tenderFor([individualOwner(1)]);
  const banned: ReadonlyArray<readonly [string, RegExp]> = [
    ["navy #1e2b4d", /#1e2b4d/i],
    ["old gold #b8873b", /#b8873b/i],
    ["gold-dark #8f6a24", /#8f6a24/i],
    ["border #d9d9d6", /#d9d9d6/i],
    ["muted #5f5f5f", /#5f5f5f/i],
    ["Georgia serif", /Georgia/],
    ["green status pill", /\bpill\b/],
    // Declarations, not prose: the stylesheet's own comments mention both of
    // these by name to record that they were deliberately dropped.
    ["uppercase transform", /text-transform\s*:\s*uppercase/],
    ["letter-spacing", /letter-spacing\s*:/],
  ];
  for (const [label, pattern] of banned) {
    assert.doesNotMatch(html, pattern, `${label} still present in the tender`);
  }
});

test("the tender uses the template's tokens and pt units", () => {
  const html = tenderFor([individualOwner(1)]);
  for (const token of [
    "#B8860B", // headings, title, price
    "#C8A951", // table header fill + its border
    "#CCCCCC", // cell borders and header/footer hairlines
    "#F2F2F2", // zebra stripe
    "#1A1A1A", // bold labels and status
    "#333333", // body
    "#242424", // client / job address
    "#555555", // running header + footer
  ]) {
    assert.ok(html.includes(token), `missing template token ${token}`);
  }
  assert.match(html, /font-size:\s*10pt/, "body is Arial 10pt");
  assert.match(html, /padding:\s*15\.875mm/, "page margins are 15.875mm");
  // Status is plain bold text, never a coloured badge.
  assert.match(html, /<td class="c-status t-status">Included<\/td>/);
});

// ─── Contract sum in words ──────────────────────────────────────────────────
// A fixed-price tender states its price in words as well as numerals so an
// altered or mis-keyed figure is self-evident. The two must never disagree.

test("the contract sum in words matches the template's own example", () => {
  // The source document prints "$750,000 / Seven hundred and fifty thousand
  // dollars" — this is that exact figure.
  assert.equal(amountInWords(750000), "Seven hundred and fifty thousand dollars");
});

test("amounts in words read as Australian English", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, "Zero dollars"],
    [1, "One dollar"],
    [15, "Fifteen dollars"],
    [40, "Forty dollars"],
    [145, "One hundred and forty-five dollars"],
    [845000, "Eight hundred and forty-five thousand dollars"],
    [1000000, "One million dollars"],
    [1000040, "One million and forty dollars"],
  ];
  for (const [value, expected] of cases) {
    assert.equal(amountInWords(value), expected, `${value} in words`);
  }
});

test("the words never disagree with the printed numerals", () => {
  // money() prints whole dollars, so the words must round the same way — a
  // tender whose figure and words differ is a contractual defect.
  for (const value of [845499.6, 845500.4, 0.4, 1.5, 999.99]) {
    const numerals = money(value);
    const digits = Number(numerals.replace(/[^0-9]/g, ""));
    assert.equal(
      amountInWords(value),
      amountInWords(digits),
      `${value} printed as ${numerals} but worded from a different rounding`,
    );
  }
});

test("the cover prints the price as numerals and words on one line", () => {
  const html = tenderFor([individualOwner(1)]);
  const match = html.match(/<div class="t-price">([^<]*)<\/div>/);
  assert.ok(match, "no price line on the cover");
  assert.match(
    match[1],
    / \/ .+ dollars?$/,
    `price line should be "$N / Words dollars", got ${JSON.stringify(match[1])}`,
  );
  // The builder's licence/ABN line must NOT sit between the brief and the
  // salutation, where it read as an interruption of the letter.
  const statutory = html.indexOf("Licence No. 383992C");
  const salutation = html.indexOf("Dear ");
  assert.ok(statutory > salutation, "statutory line still precedes the letter");
});

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
  assert.equal(styles.header.background, "rgb(200, 169, 81)", "header fill #C8A951");
  assert.equal(styles.header.color, "rgb(255, 255, 255)", "header text white");
  // Zebra restarts in every table and the FIRST data row is white.
  assert.equal(styles.firstRow.background, "rgb(255, 255, 255)", "row 1 is white");
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
  assert.ok(Math.abs(pt(styles.firstRow.padRight) - 4) < 0.1, "4pt right padding");
  assert.ok(Math.abs(pt(styles.firstRow.padBottom) - 4) < 0.1, "4pt bottom padding");
  assert.ok(Math.abs(pt(styles.firstRow.padLeft) - 6) < 0.1, "6pt left padding");
});

// ─── Step 4: anchor integrity and the injection guard ───────────────────────

function anchorCount(html: string, tag: string): number {
  return html.split(`\\${tag}\\`).length - 1;
}

test("every DocuSign anchor appears exactly once, indexed 1..N", () => {
  for (const owners of [
    [individualOwner(1)],
    [individualOwner(1), individualOwner(2)],
    [companyOwner(1, 3), individualOwner(2)],
    Array.from({ length: 10 }, (_, i) => individualOwner(i + 1)),
  ]) {
    const html = tenderFor(owners);
    const signers = collectOfferSigners(owners);
    assert.ok(signers.length > 0, "fixture produced no signers");
    for (let k = 1; k <= signers.length; k++) {
      for (const tag of [`sigOwner${k}`, `dateOwner${k}`, `initOwner${k}`]) {
        assert.equal(
          anchorCount(html, tag),
          1,
          `anchor ${tag} must appear exactly once (${signers.length} signers)`,
        );
      }
    }
    // No anchor beyond the signer count — a stale index would place a tab for a
    // recipient the envelope never created.
    for (const tag of [
      `sigOwner${signers.length + 1}`,
      `initOwner${signers.length + 1}`,
    ]) {
      assert.equal(anchorCount(html, tag), 0, `unexpected anchor ${tag}`);
    }
    assert.equal(anchorCount(html, "sigBuilder"), 1);
    assert.equal(anchorCount(html, "dateBuilder"), 1);
  }
});

// esc() strips backslashes precisely so this cannot happen. Without that strip,
// AutoPlace would find the injected token and hand this signer's tab to text the
// client controls.
test("user-controlled text cannot smuggle an anchor into the tender", () => {
  const hostile = "Bob \\sigOwner1\\ Smith";
  const owner = {
    ...individualOwner(1),
    displayName: hostile,
    currentLocation: "1 \\initOwner1\\ Street",
    signatories: [
      {
        ...individualOwner(1).signatories[0],
        name: hostile,
      },
    ],
  };
  const html = tenderFor(
    [owner],
    [{ category: "Tiling", spec: "Tiles \\dateBuilder\\ everywhere" }],
  );
  // Exactly one of each — the real one emitted by anchor().
  assert.equal(anchorCount(html, "sigOwner1"), 1, "injected sigOwner1 was placed");
  assert.equal(anchorCount(html, "initOwner1"), 1, "injected initOwner1 was placed");
  assert.equal(anchorCount(html, "dateBuilder"), 1, "injected dateBuilder was placed");
  // The visible text survives, minus its backslashes.
  assert.match(html, /Bob sigOwner1 Smith/);
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

// ─── Step 6: contract regression ────────────────────────────────────────────

// The tender was forked onto tenderDocShell() so restyling it could not restyle
// the Contract annexure, which shares legalDocShell(). This pins that promise:
// the annexure must still carry the OLD shell's tokens. If someone later
// restyles legalDocShell() in place, this fails and points at the contract.
test("the contract annexure still renders on the untouched legacy shell", () => {
  const html = buildContractSignatureAnnexureHtml({
    reference: "RC-1001-R1",
    siteAddress: "1 Test St, Sydney NSW 2000",
    ownerNamesLine: "Rakhi Pty Ltd",
    signers: [{ name: "Director 1", capacity: "Director", entityName: "Rakhi Pty Ltd" }],
  });
  for (const legacy of ["#1e2b4d", "#b8873b", "#d9d9d6", "#5f5f5f"]) {
    assert.ok(
      html.includes(legacy),
      `annexure lost legacy token ${legacy} — legalDocShell was restyled`,
    );
  }
  assert.match(html, /font-size:\s*11\.5px/, "annexure keeps its 11.5px base");
  assert.match(html, /padding:\s*16mm 18mm/, "annexure keeps its 16/18mm margins");
  // The tender's tokens must NOT have leaked into it.
  assert.doesNotMatch(html, /#C8A951/, "tender gold fill leaked into the annexure");
});
