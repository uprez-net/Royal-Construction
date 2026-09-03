import assert from "node:assert/strict";
import { test } from "node:test";

import { buildContractSignatureAnnexureHtml } from "../../lib/offer/contract-annexure-html";
import {
  amountInWords,
  money,
} from "../../lib/offer/offer-tender-html";
import { collectOfferSigners } from "../../lib/offer/workspace-model";
import {
  companyOwner,
  individualOwner,
  tenderFor,
} from "./tender-fixtures";

// Parity harness for the Royal Constructions Word tender template. Every number
// asserted here was read out of that .docx's OOXML (word/document.xml,
// word/styles.xml, word/header1.xml, word/footer1.xml) — they are measurements,
// not preferences, so a failure here means the document drifted off the
// template, not that the tolerance is too tight.
//
// Everything in THIS file asserts against the generated HTML alone, so it runs
// anywhere. The assertions that need a real browser — laid-out geometry,
// computed table styles, and page-count truth against a rendered PDF — live in
// offer-tender-print-parity.test.ts, which CI cannot run because it sets
// PUPPETEER_SKIP_DOWNLOAD and never installs Chrome.

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
