import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareTitleSearchOwners,
  describeOwnerMismatch,
  isSameOwnerName,
  nameTokens,
} from "../../lib/compliance/title-search-owners";

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

test("a name normalises to sorted, deduplicated tokens", () => {
  assert.deepEqual(nameTokens("John Smith"), ["john", "smith"]);
  // Sorted, so the register's surname-first and a contract's surname-last are
  // the same name rather than two.
  assert.deepEqual(nameTokens("Smith, John"), nameTokens("John Smith"));
  assert.deepEqual(nameTokens("SMITH JOHN"), nameTokens("John Smith"));
});

test("honorifics and post-nominals drop out", () => {
  assert.deepEqual(nameTokens("Mr John Smith"), nameTokens("John Smith"));
  assert.deepEqual(nameTokens("Dr Jane Doe Jr"), nameTokens("Jane Doe"));
});

test("company suffixes drop out, the distinctive part stays", () => {
  assert.deepEqual(
    nameTokens("Smith Holdings Pty Ltd"),
    nameTokens("SMITH HOLDINGS PTY LIMITED"),
  );
  // "holdings" is noise too — it is the least distinctive word in the name and
  // keeping it edges unrelated companies closer to matching.
  assert.deepEqual(nameTokens("Smith Holdings Pty Ltd"), ["smith"]);
});

test("punctuation, accents and ampersands normalise away", () => {
  assert.deepEqual(nameTokens("O'Brien"), nameTokens("OBrien"));
  assert.deepEqual(nameTokens("Renée Dupont"), nameTokens("Renee Dupont"));
  assert.deepEqual(nameTokens("Smith & Sons"), ["and", "smith", "sons"]);
});

test("an empty or unusable name yields no tokens", () => {
  for (const value of ["", "   ", "!!!", null, undefined]) {
    assert.deepEqual(nameTokens(value), [], JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// Matching one name against another
// ---------------------------------------------------------------------------

test("the same person written two ways is one person", () => {
  assert.equal(isSameOwnerName("John Smith", "SMITH, JOHN"), true);
  assert.equal(isSameOwnerName("Mr John Smith", "john smith"), true);
});

// A contract carries the middle name and the register does not, or the other
// way round. Losing the match over that would flag documents that are correct.
test("a middle name present on one side only still matches", () => {
  assert.equal(isSameOwnerName("John Andrew Smith", "John Smith"), true);
  assert.equal(isSameOwnerName("John Smith", "John Andrew Smith"), true);
});

test("different people do not match", () => {
  assert.equal(isSameOwnerName("John Smith", "Jane Smith"), false);
  assert.equal(isSameOwnerName("John Smith", "John Brown"), false);
  assert.equal(isSameOwnerName("John Smith", "Peter Nguyen"), false);
});

// A shared surname is a coincidence, not an identification — and the commonest
// surnames would otherwise match half a suburb.
test("a surname alone is not enough to identify anybody", () => {
  assert.equal(isSameOwnerName("Smith", "John Smith"), false);
  assert.equal(isSameOwnerName("John Smith", "Smith"), false);
});

test("a single-token name matches only the identical single token", () => {
  assert.equal(isSameOwnerName("Kalinda", "Kalinda"), true);
  assert.equal(isSameOwnerName("Kalinda", "Kalinda Pty Ltd"), true);
  assert.equal(isSameOwnerName("Kalinda", "Waratah"), false);
});

test("an empty name matches nothing", () => {
  assert.equal(isSameOwnerName("", "John Smith"), false);
  assert.equal(isSameOwnerName("John Smith", "   "), false);
});

// ---------------------------------------------------------------------------
// The comparison the alert hangs off
// ---------------------------------------------------------------------------

test("a search naming one of the owners passes", () => {
  const result = compareTitleSearchOwners({
    documentOwners: ["JOHN ANDREW SMITH", "JANE MARY SMITH"],
    projectOwners: ["John Smith", "Jane Smith"],
  });

  assert.equal(result.verdict, "match");
});

// Two people buy a house and one is on the title; a company owns it and the
// contract names the director too. Requiring both lists to agree would flag the
// ordinary case, which is the fastest way to teach everyone to ignore alerts.
test("any overlap passes — the lists need not agree", () => {
  const result = compareTitleSearchOwners({
    documentOwners: ["JOHN ANDREW SMITH"],
    projectOwners: ["John Smith", "Jane Smith"],
  });

  assert.equal(result.verdict, "match");
  if (result.verdict === "match") {
    assert.deepEqual(result.matched, ["John Smith"]);
  }
});

// The register has not caught up with settlement: it still names the vendors.
// This is the whole reason the check exists.
test("a search naming nobody we hold is a mismatch", () => {
  const result = compareTitleSearchOwners({
    documentOwners: ["PETER JAMES NGUYEN", "LINH NGUYEN"],
    projectOwners: ["John Smith", "Jane Smith"],
  });

  assert.equal(result.verdict, "mismatch");
  if (result.verdict === "mismatch") {
    assert.deepEqual(result.documentOwners, ["PETER JAMES NGUYEN", "LINH NGUYEN"]);
    assert.deepEqual(result.projectOwners, ["John Smith", "Jane Smith"]);
  }
});

// No opinion, rather than a pass or a failure. An alert raised against a
// document nobody can check is worse than no alert at all.
test("no project owners means no opinion", () => {
  const result = compareTitleSearchOwners({
    documentOwners: ["JOHN SMITH"],
    projectOwners: [],
  });
  assert.equal(result.verdict, "indeterminate");
});

test("no readable proprietors means no opinion", () => {
  const result = compareTitleSearchOwners({
    documentOwners: [],
    projectOwners: ["John Smith"],
  });
  assert.equal(result.verdict, "indeterminate");
});

test("blank entries on either side are discarded, not compared", () => {
  // A blank string tokenises to nothing and would otherwise compare against
  // everything. Dropped before the comparison, so a list of blanks reads as
  // "nothing to compare" rather than as a match or a mismatch.
  assert.equal(
    compareTitleSearchOwners({
      documentOwners: ["", "   "],
      projectOwners: ["John Smith"],
    }).verdict,
    "indeterminate",
  );
  assert.equal(
    compareTitleSearchOwners({
      documentOwners: ["JOHN SMITH"],
      projectOwners: ["", "John Smith"],
    }).verdict,
    "match",
  );
});

test("a company owner matches the register's spelling of it", () => {
  const result = compareTitleSearchOwners({
    documentOwners: ["ACME DEVELOPMENTS PTY LIMITED"],
    projectOwners: ["Acme Developments Pty Ltd"],
  });
  assert.equal(result.verdict, "match");
});

test("the mismatch detail names both sides and says what to do", () => {
  const detail = describeOwnerMismatch(
    ["PETER NGUYEN"],
    ["John Smith", "Jane Smith"],
  );

  assert.match(detail, /PETER NGUYEN/);
  assert.match(detail, /John Smith, Jane Smith/);
  assert.match(detail, /fresh search/);
});
