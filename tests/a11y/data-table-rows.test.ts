import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "vitest";

import { DataTable } from "@/components/common/data-table";
import { REPO_ROOT } from "../support/repo-root";

// Issue #477. A clickable DataTable row was role="button" with tabIndex and
// onKeyDown. Callers put links and buttons inside it, so axe reported
// nested-interactive and the inner controls vanished from the accessibility
// tree. The row is now a plain <tr> with a mouse onClick; each caller's
// primary cell is the keyboard control.

const SOURCE = join(REPO_ROOT, "components/common/data-table.tsx");

describe("DataTable rows are not controls", () => {
  test("the source never gives a row role=button", () => {
    const source = readFileSync(SOURCE, "utf8");
    assert.doesNotMatch(source, /role:\s*"button"/);
    assert.doesNotMatch(source, /role="button"/);
  });

  test("a clickable row renders as a plain <tr> with no role or tab stop", () => {
    const markup = renderToStaticMarkup(
      createElement(DataTable, {
        headers: ["Name", "Action"],
        rows: [
          [
            createElement("button", { type: "button" }, "Open file"),
            createElement("span", null, "Done"),
          ],
        ],
        onRowClick: () => {},
        rowLabel: () => "Open file",
      }),
    );

    const bodyRow = /<tr class="border-t[^"]*"[^>]*>/.exec(markup)?.[0];
    assert.ok(bodyRow, "expected a body row");
    assert.doesNotMatch(bodyRow, /role=/);
    assert.doesNotMatch(bodyRow, /tabindex=/);
    assert.doesNotMatch(bodyRow, /aria-label=/);
    // The control inside the row is still rendered and reachable.
    assert.match(markup, /<button type="button"[^>]*>Open file<\/button>/);
  });
});
