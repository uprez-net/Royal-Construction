import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { ExtractionField } from "@/components/projects/form/extracted-components";

// Issue #439. The create-project review form labelled every field with a
// <label> that had no htmlFor and did not wrap its control, so every one of
// these inputs, including the Yes/No <select>, had no accessible name. This
// renders one of each control type and checks the label points at the control.

const FIELDS: ReadonlyArray<readonly [string, string, unknown]> = [
  ["text", "builderName", "A"],
  ["textarea", "summary", "A"],
  ["number", "lotSize", 12],
  ["currency", "commercialsAndClaimsTotalContractSum", 100],
  ["percent", "commercialsAndClaimsLatePenaltyRate", 1],
  ["boolean", "commercialsAndClaimsGstIncluded", true],
  ["array", "inclusionsAndExclusionsInclusions", ["x"]],
];

for (const [kind, field, value] of FIELDS) {
  test(`${kind} field: the label's for matches a form control's id`, () => {
    const html = renderToStaticMarkup(
      createElement(ExtractionField, {
        field,
        value,
        onChange: () => undefined,
      }),
    );
    const target = /<label[^>]*\sfor="([^"]+)"/.exec(html)?.[1];
    assert.ok(target, `no <label for> in: ${html}`);
    const controls = [
      ...html.matchAll(/<(input|textarea|select)\b[^>]*\sid="([^"]+)"/g),
    ].filter((match) => match[2] === target);
    assert.equal(controls.length, 1, `no unique control with id ${target}`);
  });
}
