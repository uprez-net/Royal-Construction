import assert from "node:assert/strict";
import { test } from "vitest";

import { readGlobalsCss } from "./oklch-contrast";

// Issue #443. Every theme colour in globals.css is an oklch() value, but 39
// declarations wrapped them as `hsl(var(--ring))`. hsl() of an oklch value is
// invalid at computed-value time, so the property silently becomes `unset`
// (not "ignored": it can also wipe a valid declaration from a lower layer).
// Nothing errors, so the Leads search lost its focus ring for months. Use
// `var(--x)`, or `color-mix(in oklab, var(--x) N%, transparent)` for an alpha.

const css = readGlobalsCss().replace(/\/\*[\s\S]*?\*\//g, "");

test("no hsl(var(--token)) wraps a token that is not an HSL triplet", () => {
  const definitions = new Map<string, string[]>();
  for (const [, name, value] of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    definitions.set(name, [...(definitions.get(name) ?? []), value.trim()]);
  }

  const offenders: string[] = [];
  for (const [, name] of css.matchAll(/hsl\(\s*var\((--[\w-]+)/g)) {
    const values = definitions.get(name) ?? [];
    // A bare "H S% L%" triplet is the only thing hsl(var()) can wrap.
    const triplet =
      values.length > 0
      && values.every((value) => /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(value));
    if (!triplet) offenders.push(`hsl(var(${name}))`);
  }

  assert.deepEqual([...new Set(offenders)], []);
});
