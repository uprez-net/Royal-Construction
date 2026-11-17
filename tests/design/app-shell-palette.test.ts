import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

// The app shell painted its own palette in hex and slate: a #C6923A wordmark and
// active nav item that fall below 4.5:1 on white and on their own 10% tint,
// #E2E8F0 borders and slate-* text, all drifting from the tokens every other
// surface reads. The gold ink token clears AA. This pins the shell to tokens.
// The #F7F6F2 ground is deliberately left alone (decision D22).

const text = readFileSync(
  join(process.cwd(), "components/common/app-shell.tsx"),
  "utf8",
);

test("the shell's gold is a fill token, not a hex or gold text", () => {
  assert.doesNotMatch(text, /#C6923A/i);
  assert.match(text, /bg-royal-gold(?!-)/);
  assert.doesNotMatch(text, /text-royal-gold/);
});

test("the shell's borders are the border token, not a hex", () => {
  assert.doesNotMatch(text, /#E2E8F0/i);
});

test("the shell's neutrals are tokens, not slate utilities", () => {
  assert.doesNotMatch(text, /\bslate-\d/);
});
