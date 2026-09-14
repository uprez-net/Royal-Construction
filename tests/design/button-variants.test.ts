import assert from "node:assert/strict";
import { test } from "node:test";

import { buttonVariants } from "../../components/ui/button";
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
