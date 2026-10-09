import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { REPO_ROOT } from "../support/repo-root";

// /offers streams its skeleton first, then swaps in PageHeroCard. The skeleton's
// hero was a flat tint with p-6 while the real hero is a gradient Card with
// 40px of vertical padding, so the page flashed and jumped on the swap.

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const classesOf = (source: string, pattern: RegExp) => {
  const match = source.match(pattern)?.[1];
  assert.ok(match, `no class list matches ${pattern}`);
  return match.split(/\s+/);
};

const hero = read("components/common/page-hero-card.tsx");
const skeleton = read("app/(main)/offers/loading.tsx");

// The first class list carrying a gold border is the skeleton's hero.
const placeholder = classesOf(
  skeleton,
  /className="([^"]*border-royal-gold[^"]*)"/,
);

test("the /offers skeleton hero paints the real hero's surface", () => {
  const card = classesOf(hero, /<Card className="([^"]+)"/);

  for (const name of card) {
    assert.ok(
      placeholder.includes(name),
      `the skeleton hero is missing ${name}: ${placeholder.join(" ")}`,
    );
  }
});

test("the /offers skeleton hero keeps the real hero's padding", () => {
  // Card adds py-4 around responsive CardContent padding.
  assert.match(hero, /<CardContent className="relative p-4 sm:p-6">/);
  assert.match(read("components/ui/card.tsx"), /\bpy-4\b/);

  for (const padding of ["px-4", "py-8", "sm:px-6", "sm:py-10"]) {
    assert.ok(placeholder.includes(padding), placeholder.join(" "));
  }
});
