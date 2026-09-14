import assert from "node:assert/strict";
import { test } from "node:test";

import { buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import {
  WHITE,
  contrastRatio,
  parseOklch,
  readGlobalsCss,
  themeColour,
} from "./oklch-contrast";

// Pins the default Button hover. Its only hover was `[a]:hover:bg-primary/80`,
// which applies only when the Button renders as an <a>, so every ordinary
// <button> (Save Changes, Create Offer-Document, Add task) had no hover state.

const VARIANTS = [
  "default",
  "destructive",
  "ghost",
  "link",
  "outline",
  "royal",
  "secondary",
] as const;

test("no variant scopes its styles to an <a> element", () => {
  for (const variant of VARIANTS) {
    assert.doesNotMatch(
      buttonVariants({ variant }),
      /\[a\]:/,
      `the ${variant} variant only styles a Button rendered as a link`,
    );
  }
});

// A translucent bg-primary/90 hover would lighten the fill toward the page and
// drop white text below AA, so the hover is an opaque darker teal.
test("the default variant darkens on hover and keeps white text at AA", () => {
  const classes = buttonVariants({ variant: "default" });
  const hover = classes.match(/(?:^|\s)hover:bg-\[(oklch\([^\]]+\))\]/)?.[1];
  assert.ok(hover, `the default variant has no hover fill: ${classes}`);

  const colour = parseOklch(hover);
  const primary = themeColour(readGlobalsCss(), ":root", "--primary");
  assert.ok(colour.lightness < primary.lightness);
  assert.ok(
    contrastRatio(WHITE, colour) >= 4.5,
    `white on the default hover measures ${contrastRatio(WHITE, colour).toFixed(2)}:1`,
  );
});

test("the royal variant hovers onto the ink hover token", () => {
  const classes = buttonVariants({ variant: "royal" }).split(/\s+/);

  assert.ok(classes.includes("bg-royal-gold-ink"));
  assert.ok(classes.includes("text-white"));
  assert.ok(classes.includes("hover:bg-royal-gold-ink-hover"));
});

// Pins the royal focus ring. It was ring-royal-gold/40, 1.46:1 against a white
// page and fainter than the teal ring these gold CTAs had before. An opaque ring
// clears 3:1 against the page, and Tailwind's white offset gap keeps it from
// merging into the ink fill when the ring shares its colour.
const NON_TEXT = 3;

test("the royal focus ring stands out from the page and from its own fill", () => {
  const classes = cn(buttonVariants({ variant: "royal" })).split(/\s+/);
  const rings = classes
    .map(
      (name) =>
        name.match(/^focus-visible:ring-(?!offset-)([a-z][\w-]*(?:\/\d+)?)$/)?.[1],
    )
    .filter((name): name is string => name !== undefined);
  const ring = rings[rings.length - 1];
  assert.ok(ring, `the royal variant has no focus ring colour: ${classes.join(" ")}`);
  assert.doesNotMatch(
    ring,
    /\//,
    `focus-visible:ring-${ring} is translucent, so its contrast depends on what sits under it`,
  );

  const css = readGlobalsCss();
  const colour = themeColour(css, ":root", `--${ring}`);
  const page = themeColour(css, ":root", "--background");
  const fill = themeColour(css, ":root", "--royal-gold-ink");
  assert.ok(
    contrastRatio(WHITE, colour) >= NON_TEXT &&
      contrastRatio(page, colour) >= NON_TEXT,
    `the focus ring measures ${contrastRatio(WHITE, colour).toFixed(2)}:1 on white and ${contrastRatio(page, colour).toFixed(2)}:1 on --background`,
  );
  assert.ok(
    classes.some((name) => /^focus-visible:ring-offset-[1-9]\d*$/.test(name)),
    "without a ring offset the ring touches the ink fill",
  );
  assert.ok(contrastRatio(WHITE, fill) >= NON_TEXT);
});
