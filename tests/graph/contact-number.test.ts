import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeContactNumber } from "../../lib/graph/contact-number";

test("an Australian mobile keeps its leading zero", () => {
  // The regression: this ran through Number(), so lead 223 stored 433100349
  // for a client who had typed 0433100349 into the website form.
  assert.equal(normalizeContactNumber("0433100349"), "0433100349");
  assert.equal(normalizeContactNumber("0404 843 226"), "0404 843 226");
  assert.equal(normalizeContactNumber("(02) 9876 5432"), "(02) 9876 5432");
});

test("an international number keeps the plus that makes it international", () => {
  assert.equal(normalizeContactNumber("+61 433 100 349"), "+61 433 100 349");
  assert.equal(normalizeContactNumber("+61 (0)2 9876 5432"), "+61 (0)2 9876 5432");
});

test("long numbers are not rewritten by floating point", () => {
  // Past 15 digits Number() alters digits outright, and past 21 it switches to
  // exponential notation. Both used to be written into Lead.phone verbatim.
  assert.equal(normalizeContactNumber("12345678901234567"), "12345678901234567");
  assert.equal(
    normalizeContactNumber("1234567890123456789012"),
    "1234567890123456789012",
  );
});

test("an extension survives instead of being welded onto the number", () => {
  assert.equal(normalizeContactNumber("02 9876 5432 ext 12"), "02 9876 5432 ext 12");
});

test("surrounding and repeated whitespace is tidied", () => {
  assert.equal(normalizeContactNumber("  0433  100   349 "), "0433 100 349");
  assert.equal(normalizeContactNumber("0433\r\n100349"), "0433 100349");
});

test("input with no digit yields an empty phone, never the string zero", () => {
  // Number() returned 0 here, which the save site stringified to "0" and stored
  // as if it were a real phone number.
  assert.equal(normalizeContactNumber(""), "");
  assert.equal(normalizeContactNumber("   "), "");
  assert.equal(normalizeContactNumber("N/A"), "");
  assert.equal(normalizeContactNumber(undefined), "");
  assert.equal(normalizeContactNumber(null), "");
});
