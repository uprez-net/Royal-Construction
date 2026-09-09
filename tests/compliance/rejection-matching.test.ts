import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  comparableName,
  matchRejection,
  type RejectionCandidate,
} from "@/lib/compliance/rejection-matching";

/**
 * Landing an objection on the row it is about.
 *
 * The one genuinely uncertain step in the DA and checklist pipelines, and the
 * only one where being wrong is worse than doing nothing: a rejection on the
 * wrong row sends an accepted document back to outstanding and leaves the
 * refused one reading as fine, so the thing the council actually objected to
 * becomes the one row nobody is looking at.
 *
 * So the cases below are weighted towards the refusals rather than the matches.
 * Every "returns null" test is a message that looked matchable and must not be.
 */

/** A row as the data layer builds one, with its names already normalised. */
const row = (
  id: string,
  names: string[],
  order: number | null = null,
): RejectionCandidate => ({
  id,
  names: names.map(comparableName),
  order,
});

const HYDRAULIC = row("hydraulic", [
  "Hydraulic/stormwater drawings & design certificate",
  "HYDRAULIC STORMWATER DRAWINGS",
]);
const BASIX = row("basix", ["BASIX Certificate", "BASIX CERTIFICATE"]);
const SHADOW = row("shadow", ["Shadow diagrams"], 3);
const WASTE = row("waste", ["Waste management plan"], 7);

const DA_ROWS = [HYDRAULIC, BASIX, SHADOW, WASTE];

describe("normalising a name", () => {
  it("ignores case and punctuation", () => {
    assert.equal(
      comparableName("Hydraulic/Stormwater Drawings"),
      comparableName("hydraulic stormwater drawings"),
    );
  });

  it("treats a plural as the same thing", () => {
    // A council writing "Shadow Diagrams" in March and "shadow diagram" in
    // April is naming one thing twice.
    assert.equal(comparableName("Shadow Diagrams"), comparableName("shadow diagram"));
  });

  it("leaves short words that merely end in s alone", () => {
    // The plural strip is crude on purpose and must not eat real words.
    assert.equal(comparableName("gas"), "gas");
    assert.equal(comparableName("access"), "access");
  });
});

describe("matching an objection to a row", () => {
  it("matches when the council names part of our label", () => {
    assert.equal(
      matchRejection("the stormwater drawings", DA_ROWS),
      "hydraulic",
    );
  });

  it("matches when the council's name is longer than ours", () => {
    assert.equal(
      matchRejection("BASIX Certificate issued 12 March", DA_ROWS),
      "basix",
    );
  });

  it("matches on a distinctive word when neither name contains the other", () => {
    assert.equal(
      matchRejection("amended stormwater plan", DA_ROWS),
      "hydraulic",
    );
  });

  it("matches a certifier's item number", () => {
    // The case with no words worth matching at all.
    assert.equal(matchRejection("item 7", DA_ROWS), "waste");
    assert.equal(matchRejection("Item 3 is not acceptable", DA_ROWS), "shadow");
  });

  it("ignores a number on a row that is not on a numbered list", () => {
    const unnumbered = [row("a", ["Build cost summary"])];
    assert.equal(matchRejection("item 1", unnumbered), null);
  });
});

describe("refusing to guess", () => {
  it("returns null when nothing resembles the name", () => {
    assert.equal(matchRejection("arborist report", DA_ROWS), null);
  });

  it("returns null on a word every document name shares", () => {
    // The reason the generic list exists. "the amended plan" would otherwise
    // land on whichever row has "plan" in its name first, which is a coin toss
    // between the shadow diagrams and the waste management plan.
    assert.equal(matchRejection("the amended plan", DA_ROWS), null);
    assert.equal(matchRejection("revised documents", DA_ROWS), null);
  });

  it("returns null when two rows match equally well", () => {
    // Two checklist lines about stormwater. Picking one is picking at random,
    // and the objection is reported instead so a person can place it.
    const ambiguous = [
      row("one", ["Stormwater drawings"]),
      row("two", ["Stormwater management plan"]),
    ];
    assert.equal(matchRejection("stormwater", ambiguous), null);
  });

  it("returns null when two rows share the same item number", () => {
    const clashing = [row("a", ["First list item"], 7), row("b", ["Second"], 7)];
    assert.equal(matchRejection("item 7", clashing), null);
  });

  it("returns null on an empty or unusable name", () => {
    assert.equal(matchRejection("", DA_ROWS), null);
    assert.equal(matchRejection("   ", DA_ROWS), null);
    assert.equal(matchRejection("!!!", DA_ROWS), null);
  });

  it("returns null when there are no rows to match against", () => {
    assert.equal(matchRejection("the stormwater drawings", []), null);
  });

  it("does not let a blank stored name swallow everything", () => {
    // A row with no label normalises to "", and "".includes(x) is false while
    // x.includes("") is true — so an unguarded substring test would match every
    // objection to the first nameless row on the file.
    const blank = [row("blank", ["", ""]), BASIX];
    assert.equal(matchRejection("BASIX certificate", blank), "basix");
  });
});
