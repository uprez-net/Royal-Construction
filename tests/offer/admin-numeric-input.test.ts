import assert from "node:assert/strict";
import { test } from "node:test";

import { isRawCurrent } from "../../components/offers/admin/shared/numeric-input";

// The HBCF numeric fields commit NaN while their text is not yet a number, then
// resync the text from the store whenever the value changes. The resync treated
// only "" as matching NaN, so typing "." (for ".5") was replaced with "" at once
// and the admin could not start a decimal with its point.

test("text that is not yet a number matches a NaN value", () => {
  assert.equal(isRawCurrent(".", Number.NaN), true);
  assert.equal(isRawCurrent("", Number.NaN), true);
});

test("a trailing point still matches the number before it", () => {
  assert.equal(isRawCurrent("5.", 5), true);
});

test("text for a different value, or none, does not match a real value", () => {
  assert.equal(isRawCurrent("12", 5), false);
  assert.equal(isRawCurrent("", 5), false);
});
