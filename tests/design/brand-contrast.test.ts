import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

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

// The app ships light-only, but .dark must still define the tokens so the
// utility never resolves to an undefined var, and both steps must carry the
// variant's white text. Checking only the hover is how the dark REST state sat
// at 3.75:1 unnoticed — and rest is what variant="royal" paints until someone
// points at it.
test("the dark theme carries white text at rest and on hover", () => {
  const ink = themeColour(css, ".dark", "--royal-gold-ink");
  const hover = themeColour(css, ".dark", "--royal-gold-ink-hover");

  assert.ok(
    contrastRatio(WHITE, ink) >= AA_TEXT,
    `white on the dark --royal-gold-ink measures ${ratio(contrastRatio(WHITE, ink))}`,
  );
  assert.ok(
    contrastRatio(WHITE, hover) >= AA_TEXT,
    `white on the dark --royal-gold-ink-hover measures ${ratio(contrastRatio(WHITE, hover))}`,
  );
});

// Gold serves two roles and they pull opposite ways in dark: the fill carries
// white text so it must darken, while gold AS TEXT sits on a dark surface and
// must lighten. Darkening the fill for the button silently dropped the text use
// to 3.66:1, which is why both are pinned here.
test("dark gold-as-text clears AA on the surfaces it sits on", () => {
  const text = themeColour(css, ".dark", "--royal-gold-ink-text");

  for (const surface of ["--card", "--background", "--muted"] as const) {
    const measured = contrastRatio(themeColour(css, ".dark", surface), text);
    assert.ok(
      measured >= AA_TEXT,
      `--royal-gold-ink-text on ${surface} measures ${ratio(measured)}`,
    );
  }
});

// The light theme's two gold tokens must stay the same colour: the split exists
// for dark only, and a drift in light would go unnoticed otherwise.
test("light gold-as-text matches the light fill", () => {
  const fill = themeColour(css, ":root", "--royal-gold-ink");
  const text = themeColour(css, ":root", "--royal-gold-ink-text");

  assert.deepEqual(text, fill);
});

// Gold text on the light-gold chip: --royal-gold-light is never redefined for
// dark, so it stays near-white there while the dark text token lightens. That
// pairing measured 2.81:1 in dark, which is why the dashed add-dwelling hover
// switches to a gold FILL with white text under .dark instead.
test("gold text on the light-gold chip clears AA in light", () => {
  const chip = themeColour(css, ":root", "--royal-gold-light");
  const text = themeColour(css, ":root", "--royal-gold-ink-text");

  const measured = contrastRatio(chip, text);
  assert.ok(
    measured >= AA_TEXT,
    `gold on --royal-gold-light measures ${ratio(measured)}`,
  );
});

test("the dark hover is a darker step of the dark ink", () => {
  const ink = themeColour(css, ".dark", "--royal-gold-ink");
  const hover = themeColour(css, ".dark", "--royal-gold-ink-hover");

  assert.ok(
    hover.lightness < ink.lightness,
    "the dark hover must darken, as the light one does",
  );
});

test("Tailwind exposes the hover token as a colour utility", () => {
  const theme = css.match(/^@theme inline \{([\s\S]*?)^\}/m)?.[1] ?? "";

  assert.match(
    theme,
    /--color-royal-gold-ink-hover:\s*var\(--royal-gold-ink-hover\);/,
  );
});

// Whole-repo guard: a class list, or an element's children, painting white text
// on base gold fails. --card is oklch(1 0 0), so text-card is white too. Alpha
// forms such as text-white/90 match because "/" ends the name.
const BASE_GOLD_FILL = /(?<![\w-])bg-royal-gold(?![\w-])/;
const WHITE_TEXT = /(?<![\w-])text-(?:white|primary-foreground|card)(?![\w-])/;
// A child that paints its own background is not sitting on the gold. The fill
// has to be the resting one: a variant-only fill (hover:bg-black, md:bg-slate-900)
// leaves the normal state on the gold, so requiring a class-token boundary
// rather than any non-word character keeps those from exempting themselves.
const OWN_FILL = /(?:^|[\s"'`])bg-(?!royal-gold(?![\w-]))[\w[]/;

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

// Where the JSX opening tag starting at `open` ends, and whether it closes
// itself. Braces are counted so an arrow's "=>" in an attribute does not end it.
function openingTag(
  source: string,
  open: number,
): { end: number; selfClosing: boolean } | null {
  let depth = 0;
  // Quoted attribute values are skipped whole: a title="}" would otherwise
  // unbalance depth, or a quoted ">" end the tag early, and returning null
  // makes elementChildren skip the element — a guard that fails OPEN, letting
  // nested white text through.
  let quote: string | null = null;
  for (let i = open + 1; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    } else if (char === ">" && depth === 0) {
      return { end: i, selfClosing: source[i - 1] === "/" };
    }
  }
  return null;
}

// The children of the element whose opening tag holds `offset`, or null when
// it closes itself or cannot be read. The selected booking slot put its fill
// on the <button> and text-card on the spans inside, which no single class
// list shows.
function elementChildren(source: string, offset: number): string | null {
  const open = source.lastIndexOf("<", offset);
  const name = /^<([A-Za-z][\w.]*)/.exec(source.slice(open, open + 80))?.[1];
  const tag = name ? openingTag(source, open) : null;
  if (!name || !tag || tag.selfClosing || tag.end < offset) {
    return null;
  }
  const tags = new RegExp(`<(/?)${name.replace(/\./g, "\\.")}(?![\\w.])`, "g");
  tags.lastIndex = tag.end + 1;
  let depth = 1;
  for (let match = tags.exec(source); match; match = tags.exec(source)) {
    if (!match[1]) {
      depth += openingTag(source, match.index)?.selfClosing ? 0 : 1;
    } else if (--depth === 0) {
      return source.slice(tag.end + 1, match.index);
    }
  }
  return null;
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
        if (!BASE_GOLD_FILL.test(unit.text)) {
          continue;
        }
        const fill = unit.start + unit.text.search(BASE_GOLD_FILL);
        const children = WHITE_TEXT.test(unit.text)
          ? null
          : elementChildren(source, fill);
        const whiteChild =
          children !== null
          && classListUnits(children).some(
            (child) =>
              WHITE_TEXT.test(child.text) && !OWN_FILL.test(child.text),
          );
        if (WHITE_TEXT.test(unit.text) || whiteChild) {
          hits.push(source.slice(0, fill).split("\n").length - 1);
        }
      }
      for (const index of hits) {
        offenders.add(`${path}:${index + 1}`);
      }
    }
  }

  assert.deepEqual(
    [...offenders],
    [],
    'gold that carries text belongs on bg-royal-gold-ink or <Button variant="royal">',
  );
});

// Before --royal-gold-ink-hover existed, ink buttons hovered onto a color-mix()
// or a translucent /90 step. The translucent step lightens toward the page, so
// white text loses contrast exactly where the pointer is.
const INK_HOVER_STAND_IN =
  // The whole modifier token, not just digits: Tailwind takes arbitrary forms
  // (hover:bg-royal-gold-ink/[90%], /[.9]) and a \d+ match let those through.
  /hover:bg-royal-gold-ink\/[^\s"'`]+|color-mix\(in_oklab,var\(--royal-gold-ink\)/;

test("ink hovers use the hover token rather than a stand-in", () => {
  const offenders: string[] = [];
  for (const root of ["app", "components"]) {
    for (const file of sourceFiles(join(process.cwd(), root))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (INK_HOVER_STAND_IN.test(line)) {
            offenders.push(`${relative(process.cwd(), file)}:${index + 1}`);
          }
        });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'hover onto hover:bg-royal-gold-ink-hover or use <Button variant="royal">',
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
    for (
      let i = (match.index ?? 0) + match[0].length - 1;
      i < bare.length;
      i++
    ) {
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

// ── The warm light theme (DESIGN.md §2, owner decision 16 Nov 2026) ────────────
// Gold is the app's only action colour and teal is retired, so `--primary` and
// `--ring` are the royal ink. They are written out rather than aliased (the
// helper parses literal oklch values), and nothing else keeps them in step.
test("--primary and --ring are the royal gold ink", () => {
  const ink = themeColour(css, ":root", "--royal-gold-ink");

  assert.deepEqual(themeColour(css, ":root", "--primary"), ink);
  assert.deepEqual(themeColour(css, ":root", "--ring"), ink);
});

test("white on --primary clears AA", () => {
  const measured = contrastRatio(WHITE, themeColour(css, ":root", "--primary"));

  assert.ok(
    measured >= AA_TEXT,
    `white on --primary measures ${ratio(measured)}`,
  );
});

// Every text colour against every surface it is drawn on. --muted is the
// surface most likely to fail: the warm --muted is darker than the cool one it
// replaced, and the -ink tokens' own comment claims 4.55:1 on it.
const SURFACES = ["--background", "--card", "--muted", "--secondary"] as const;
const TEXT_ON_SURFACES = [
  "--foreground",
  "--muted-foreground",
  "--destructive-ink",
  "--success-ink",
  "--warning-ink",
  "--info-ink",
  "--royal-gold-ink-text",
] as const;

for (const text of TEXT_ON_SURFACES) {
  test(`${text} clears AA on every light surface`, () => {
    const colour = themeColour(css, ":root", text);

    for (const surface of SURFACES) {
      const measured = contrastRatio(
        themeColour(css, ":root", surface),
        colour,
      );
      assert.ok(
        measured >= AA_TEXT,
        `${text} on ${surface} measures ${ratio(measured)}`,
      );
    }
  });
}

test("the rail's text clears AA on the charcoal rail", () => {
  const rail = themeColour(css, ":root", "--sidebar");

  for (const text of ["--sidebar-foreground", "--sidebar-accent-foreground"]) {
    const measured = contrastRatio(rail, themeColour(css, ":root", text));
    assert.ok(
      measured >= AA_TEXT,
      `${text} on --sidebar measures ${ratio(measured)}`,
    );
  }
});

// Gold is a fill on the rail's active item, so dark ink sits on it.
test("the rail's gold fill carries dark ink at AA", () => {
  const measured = contrastRatio(
    themeColour(css, ":root", "--sidebar-primary"),
    themeColour(css, ":root", "--sidebar-primary-foreground"),
  );

  assert.ok(
    measured >= AA_TEXT,
    `ink on the rail's gold measures ${ratio(measured)}`,
  );
});

// A control's border and the focus ring must read against the page (3:1).
test("the focus ring stands out from the page", () => {
  const page = themeColour(css, ":root", "--background");

  for (const token of ["--ring"] as const) {
    const measured = contrastRatio(page, themeColour(css, ":root", token));
    assert.ok(
      measured >= 3,
      `${token} on --background measures ${ratio(measured)}`,
    );
  }
});

// Teal is retired from the light theme's tokens (hue 183). The .dark block is
// unreachable (DESIGN.md: no dark mode) and is left for a later cleanup.
test("no light-theme token is still teal", () => {
  const TEAL_HUE = /oklch\(\s*[\d.]+\s+[\d.]+\s+18\d(?:\.\d+)?/;
  const root = css.match(/^:root \{([\s\S]*?)^\}/m)?.[1] ?? "";
  const stale = root
    .split("\n")
    .filter((line) => !line.trim().startsWith("/*") && TEAL_HUE.test(line));

  assert.deepEqual(stale, [], "teal-hued tokens remain in :root");
});

// The status inks are also solid chip fills with white text, so white must clear
// AA on each of them, not only the ink-on-surface pairs above.
test("white text clears AA on the solid status inks", () => {
  for (const token of [
    "--success-ink",
    "--warning-ink",
    "--destructive-ink",
    "--info-ink",
  ] as const) {
    const measured = contrastRatio(WHITE, themeColour(css, ":root", token));
    assert.ok(
      measured >= AA_TEXT,
      `white on ${token} measures ${ratio(measured)}`,
    );
  }
});
