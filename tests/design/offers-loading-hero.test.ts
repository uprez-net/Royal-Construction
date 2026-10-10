import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeroCard } from "@/components/common/page-hero-card";
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
  // Render the real components so cn() merges their defaults and overrides.
  const markup = renderToStaticMarkup(
    createElement(PageHeroCard, {
      title: "Offers",
      description: "Offers",
      headingLevel: "h1",
    }),
  );
  const card = classesOf(markup, /data-slot="card"[^>]*class="([^"]+)"/);
  const content = classesOf(
    markup,
    /data-slot="card-content"[^>]*class="([^"]+)"/,
  );

  // Compare all four edges at every responsive size, including inherited values.
  // Numeric padding is expressed in Tailwind spacing units, so no particular
  // padding token or class order is part of the contract.
  const breakpoints = ["", "sm", "md", "lg", "xl", "2xl"];
  const paddingAt = (classes: string[], breakpoint: number) => {
    const edges = { t: 0, r: 0, b: 0, l: 0 };
    for (const prefix of breakpoints.slice(0, breakpoint + 1)) {
      for (const axis of ["", "x", "y", "t", "r", "b", "l"]) {
        const utility = `${prefix ? `${prefix}:` : ""}p${axis}-`;
        for (const name of classes.filter((name) => name.startsWith(utility))) {
          const value = Number(name.slice(utility.length));
          assert.ok(
            Number.isFinite(value),
            `Unsupported padding utility: ${name}`,
          );
          if (axis === "" || axis === "y" || axis === "t") edges.t = value;
          if (axis === "" || axis === "x" || axis === "r") edges.r = value;
          if (axis === "" || axis === "y" || axis === "b") edges.b = value;
          if (axis === "" || axis === "x" || axis === "l") edges.l = value;
        }
      }
    }
    return edges;
  };
  for (const [index, breakpoint] of breakpoints.entries()) {
    const outer = paddingAt(card, index);
    const inner = paddingAt(content, index);
    assert.deepEqual(
      paddingAt(placeholder, index),
      {
        t: outer.t + inner.t,
        r: outer.r + inner.r,
        b: outer.b + inner.b,
        l: outer.l + inner.l,
      },
      `Hero padding differs at ${breakpoint || "base"}`,
    );
  }
});
