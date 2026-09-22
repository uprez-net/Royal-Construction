import assert from "node:assert/strict";
import { test } from "vitest";

import {
  checklistDocumentDetail,
  checklistItemDetail,
} from "@/types/compliance";

// The column is Json, so it holds whatever was written there — including null
// for every row predating it, and whatever shape an older extraction wrote. A
// row that cannot be read has to render as a plain row rather than taking the
// whole compliance tab down with it.
test("anything that is not an object reads as no detail", () => {
  for (const value of [
    null,
    undefined,
    "",
    "a string",
    42,
    true,
    [],
    ["requirements"],
  ]) {
    assert.equal(checklistItemDetail(value), null, JSON.stringify(value));
    assert.equal(checklistDocumentDetail(value), null, JSON.stringify(value));
  }
});

test("an object with nothing worth showing reads as no detail", () => {
  // `version` alone is not content. A blob holding only it must be
  // indistinguishable from no blob, or every consumer needs two checks.
  assert.equal(checklistItemDetail({}), null);
  assert.equal(checklistItemDetail({ version: 1 }), null);
  assert.equal(
    checklistItemDetail({ requirements: [], references: [], clause: "  " }),
    null,
  );
  assert.equal(checklistDocumentDetail({ version: 1, notes: [] }), null);
});

test("a well-formed item detail comes back whole", () => {
  const detail = checklistItemDetail({
    version: 1,
    clause: "4a",
    group: "Design Documentation",
    description: "Architect Plans need to be amended as per following,",
    requirements: [
      "Cut cannot be proposed on zero wall, garage slab level may be increased.",
      "Staircase area cannot be deducted on ground floor. GFA calculation sheet A17 need to be corrected.",
    ],
    references: ["NCC Volume 2 Amendment 1", "AS3500.3-2021"],
    mapsToType: "FULL_ARCHITECTURAL_DESIGN",
  });

  assert.ok(detail);
  assert.equal(detail.clause, "4a");
  assert.equal(detail.group, "Design Documentation");
  assert.equal(detail.requirements?.length, 2);
  assert.equal(detail.references?.length, 2);
  assert.equal(detail.mapsToType, "FULL_ARCHITECTURAL_DESIGN");
});

test("blank and non-string entries are dropped from the lists", () => {
  const detail = checklistItemDetail({
    clause: "  4a  ",
    requirements: ["  Provide Design Plans.  ", "", "   ", null, 7, {}],
    references: [],
  });

  assert.ok(detail);
  assert.equal(detail.clause, "4a");
  assert.deepEqual(detail.requirements, ["Provide Design Plans."]);
  // An empty list is absent rather than empty, so a caller tests one thing.
  assert.equal(detail.references, undefined);
});

test("a mapsToType that is not a live document type is dropped", () => {
  // The blob may predate a type being renamed or removed. An unknown string
  // reaching the UI would be a document type nothing can render.
  const detail = checklistItemDetail({
    clause: "1",
    mapsToType: "SOME_TYPE_THAT_WAS_REMOVED",
  });

  assert.ok(detail);
  assert.equal(detail.mapsToType, undefined);
});

test("document detail keeps header pairs, notes and the certifier", () => {
  const detail = checklistDocumentDetail({
    version: 1,
    header: [
      { label: "Project No.", value: "260449" },
      { label: "Re", value: "260449/01 - 11 Wheat Street, Oran Park NSW 2570" },
      { label: "", value: "dropped" },
      { label: "dropped", value: "  " },
      "not a pair",
    ],
    notes: [
      "A full assessment will not be undertaken until all items have been submitted.",
    ],
    certifier: { name: "Asik Regmi", dated: "22 July 2026", contact: "  " },
  });

  assert.ok(detail);
  assert.equal(detail.header?.length, 2);
  assert.equal(detail.header?.[0].value, "260449");
  assert.equal(detail.notes?.length, 1);
  assert.equal(detail.certifier?.name, "Asik Regmi");
  // Blank fields are absent rather than empty strings.
  assert.equal(detail.certifier?.contact, undefined);
});
