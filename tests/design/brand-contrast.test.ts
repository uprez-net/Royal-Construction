import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import {
  WHITE,
  contrastRatio,
  readGlobalsCss,
  themeColour,
} from "./oklch-contrast";

// Pins the gold CTA contrast fix. White text on --royal-gold measures 2.77:1
// and on its --royal-gold-dark hover 3.86:1, so every gold "Send offer",
// "Generate Tender" and error "Try again" button failed WCAG AA. Gold that
// carries text now sits on --royal-gold-ink with a darker
// --royal-gold-ink-hover. These checks measure the declared tokens rather than
// trusting a ratio written in a comment.

const AA_TEXT = 4.5;
const css = readGlobalsCss();

const ratio = (value: number) => `${value.toFixed(2)}:1`;

test("white text on the royal ink clears AA at rest and on hover", () => {
  const ink = themeColour(css, ":root", "--royal-gold-ink");
  const hover = themeColour(css, ":root", "--royal-gold-ink-hover");

  assert.ok(
    contrastRatio(WHITE, ink) >= AA_TEXT,
    `white on --royal-gold-ink measures ${ratio(contrastRatio(WHITE, ink))}`,
  );
  assert.ok(
    contrastRatio(WHITE, hover) >= AA_TEXT,
    `white on --royal-gold-ink-hover measures ${ratio(contrastRatio(WHITE, hover))}`,
  );
});

test("the royal hover is a darker step of the ink", () => {
  const ink = themeColour(css, ":root", "--royal-gold-ink");
  const hover = themeColour(css, ":root", "--royal-gold-ink-hover");

  assert.ok(hover.lightness < ink.lightness);
});

// The app ships light-only, but .dark must still define the token so the
// utility never resolves to an undefined var, and its step must still carry
// the variant's white text.
test("the dark theme defines a royal hover that still carries white text", () => {
  const hover = themeColour(css, ".dark", "--royal-gold-ink-hover");

  assert.ok(
    contrastRatio(WHITE, hover) >= AA_TEXT,
    `white on the dark --royal-gold-ink-hover measures ${ratio(contrastRatio(WHITE, hover))}`,
  );
});

test("Tailwind exposes the hover token as a colour utility", () => {
  const theme = css.match(/^@theme inline \{([\s\S]*?)^\}/m)?.[1] ?? "";

  assert.match(
    theme,
    /--color-royal-gold-ink-hover:\s*var\(--royal-gold-ink-hover\);/,
  );
});

// Whole-repo guard. Gold sites are split across several batches, so this
// passes once all of them have landed; until then it names the files still
// painting white text on base gold. --card is oklch(1 0 0), so text-card is
// white too. Alpha forms such as text-white/90 match because "/" ends the name.
const BASE_GOLD_FILL = /(?<![\w-])bg-royal-gold(?![\w-])/;
const WHITE_TEXT = /(?<![\w-])text-(?:white|primary-foreground|card)(?![\w-])/;

// The booking page sits outside the offer batches that own the other gold
// sites, and its Try again and Book buttons still paint text-card on base gold
// (2.77:1). They are matched by their class list rather than excused by file,
// so a new gold site on that page still fails. Drop an entry once it moves to
// the ink.
const KNOWN_GAPS: ReadonlyArray<readonly [file: string, classes: string]> = [
  [
    "app/book-consultation/page.tsx",
    "bg-royal-gold text-card hover:bg-royal-gold-dark",
  ],
  [
    "app/book-consultation/page.tsx",
    "w-full gap-2 bg-royal-gold py-6 font-condensed text-[15px] font-medium uppercase tracking-wide text-card hover:bg-royal-gold-dark",
  ],
];

const CLOSING: Readonly<Record<string, string>> = { "{": "}", "(": ")" };

// A className attribute or a cn()/cva()/clsx() call is read whole, because a
// class list split across lines puts the fill and the text colour on different
// lines. Returns the offset of each unit's opening bracket or quote.
function classListUnits(source: string): { start: number; text: string }[] {
  const units: { start: number; text: string }[] = [];
  for (const match of source.matchAll(
    /className=(["'{])|\b(?:cn|cva|clsx)\(/g,
  )) {
    const open = match[1] ?? "(";
    const start = (match.index ?? 0) + match[0].length - 1;
    const close = CLOSING[open] ?? open;
    if (close === open) {
      const end = source.indexOf(close, start + 1);
      units.push({ start, text: source.slice(start, end + 1) });
      continue;
    }
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      if (source[i] === open) {
        depth += 1;
      } else if (source[i] === close && --depth === 0) {
        units.push({ start, text: source.slice(start, i + 1) });
        break;
      }
    }
  }
  return units;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    // The prototype is a frozen design reference, not shipped UI.
    if (name.includes("prototype")) {
      continue;
    }
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

test("no class list pairs a base --royal-gold fill with white text", () => {
  const offenders = new Set<string>();
  for (const root of ["app", "components"]) {
    for (const file of sourceFiles(join(process.cwd(), root))) {
      const path = relative(process.cwd(), file);
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      // Lines still count on their own so a class string held in a constant,
      // outside any className or cn(), is caught.
      const hits = lines.flatMap((line, index) =>
        BASE_GOLD_FILL.test(line) && WHITE_TEXT.test(line) ? [index] : [],
      );
      for (const unit of classListUnits(source)) {
        if (BASE_GOLD_FILL.test(unit.text) && WHITE_TEXT.test(unit.text)) {
          const fill = unit.start + unit.text.search(BASE_GOLD_FILL);
          hits.push(source.slice(0, fill).split("\n").length - 1);
        }
      }
      for (const index of hits) {
        const known = KNOWN_GAPS.some(
          ([gapFile, classes]) =>
            gapFile === path && lines[index].includes(`"${classes}"`),
        );
        if (!known) {
          offenders.add(`${path}:${index + 1}`);
        }
      }
    }
  }

  assert.deepEqual(
    [...offenders],
    [],
    'gold that carries text belongs on bg-royal-gold-ink or <Button variant="royal">',
  );
});

// With "Background graphics" off, browsers drop background fills, so the
// Download cover printed its white text on white. The emailed PDF forces fills
// in its own HTML; the in-app print template takes them from globals.css.
test("the offer print template keeps its fills when background graphics are off", () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const printBlocks: string[] = [];
  for (const match of bare.matchAll(/@media print \{/g)) {
    let depth = 0;
    for (let i = (match.index ?? 0) + match[0].length - 1; i < bare.length; i++) {
      if (bare[i] === "{") {
        depth += 1;
      } else if (bare[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          printBlocks.push(bare.slice(match.index, i));
          break;
        }
      }
    }
  }
  const rule =
    printBlocks
      .join("\n")
      .match(/\[data-offer-print-template\]\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(rule, /(?:^|[\s;])print-color-adjust:\s*exact/);
  assert.match(rule, /-webkit-print-color-adjust:\s*exact/);
});
