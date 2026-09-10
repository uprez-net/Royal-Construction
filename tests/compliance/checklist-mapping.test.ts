import assert from "node:assert/strict";
import { test } from "node:test";

import { ComplianceDocumentType } from "@prisma/client";

import {
  CHECKLIST_MAPPABLE_TYPES,
  isChecklistMappableType,
  mappedDocumentSource,
} from "../../constants/complianceDocuments";
import { checklistDocumentType } from "../../lib/compliance/checklist-mapping";

/**
 * Reading a certifier's checklist line and saying what it asks for.
 *
 * The half of the mapping that can be tested without a database, and the half
 * that decides everything: a line that resolves to a type is answered from the
 * file if we hold one, offered a consultant if somebody produces one, and
 * offered a portal link if it is bought. A line that resolves to nothing is an
 * ordinary row with an Upload button, which is the right failure — but a line
 * that resolves to the *wrong* type puts a document on a row the certifier
 * will reject, so the two directions are not symmetric and both are pinned.
 */

const line = (label: string, description?: string) => ({
  label,
  detail: description
    ? ({ version: 1, description } as unknown as never)
    : null,
});

// ---------------------------------------------------------------------------
// The extraction's own answer wins
// ---------------------------------------------------------------------------

test("the extraction's mapsToType is taken over any reading of the label", () => {
  // A line whose wording says survey and whose extracted type says geotechnical
  // report. The model read the whole item — its description, its requirements,
  // its citations — and this read a string; where they disagree the model is
  // the better witness.
  const item = {
    label: "Survey report",
    detail: {
      version: 1,
      mapsToType: ComplianceDocumentType.GEOTECH_REPORT,
    } as unknown as never,
  };

  assert.equal(
    checklistDocumentType(item),
    ComplianceDocumentType.GEOTECH_REPORT,
  );
});

// ---------------------------------------------------------------------------
// The keyword fallback
// ---------------------------------------------------------------------------

test("the six documents the file already holds are recognised by name", () => {
  const cases: [string, ComplianceDocumentType][] = [
    ["Deposited Plan", ComplianceDocumentType.DEPOSITED_PLAN],
    [
      "Title Search",
      ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL,
    ],
    ["Signed Survey", ComplianceDocumentType.SURVEY],
    [
      "Architectural drawings",
      ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
    ],
    [
      "10.7 Planning Certificate",
      ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
    ],
    ["HBCF Warranty", ComplianceDocumentType.HOME_INSURANCE],
  ];

  for (const [label, expected] of cases) {
    assert.equal(
      checklistDocumentType(line(label)),
      expected,
      `"${label}" should read as ${expected}`,
    );
  }
});

test("a BAL risk assessment certificate is a bushfire report", () => {
  // The wording this pass was written for. A NSW certifier writes "BAL Risk
  // Assessment Certificate", or "Bushfire Certificate", far more often than
  // "bushfire attack level report" — and an unlabelled line offers an Upload
  // button where it should be offering to ring a bushfire assessor.
  for (const label of [
    "BAL Risk Assessment Certificate (Bushfire Certificate)",
    "Bushfire Certificate",
    "BAL Rating",
    "Bushfire attack level report",
  ]) {
    assert.equal(
      checklistDocumentType(line(label)),
      ComplianceDocumentType.BUSHFIRE_REPORT,
      `"${label}" should read as a bushfire report`,
    );
  }
});

test("the description is read when the label alone says nothing", () => {
  // "Long Service Levy" is the certifier's shorthand; the sentence under it is
  // where the identifying words live. A matcher reading only labels would leave
  // this line with no portal link on it.
  assert.equal(
    checklistDocumentType(
      line(
        "Levy",
        "Provide receipt of payments made to the Long Service Payments Corporation for 0.25% of the construction cost",
      ),
    ),
    ComplianceDocumentType.LONG_SERVICE_LEVY,
  );
});

test("the consultants' documents are recognised in trade shorthand", () => {
  const cases: [string, ComplianceDocumentType][] = [
    ["Structural drawings & Design Certificate", ComplianceDocumentType.STRUCTURAL_DRAWINGS],
    [
      "Hydraulic/Stormwater drawings & Design Certificate",
      ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS,
    ],
    ["Geotech Report", ComplianceDocumentType.GEOTECH_REPORT],
    [
      "Tap In or Water Service Coordinator approval",
      ComplianceDocumentType.WATER_SERVICING_APPROVAL,
    ],
    [
      "Section 73 notice of requirements",
      ComplianceDocumentType.SECTION_73_NOTICE,
    ],
    [
      "Road Opening & Vehicle Crossing",
      ComplianceDocumentType.ROAD_OPENING_PERMIT,
    ],
    [
      "Mine subsidence approval",
      ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL,
    ],
    ["Waste Management Plan", ComplianceDocumentType.WASTE_MANAGEMENT_PLAN],
    ["Traffic Control plan", ComplianceDocumentType.TRAFFIC_CONTROL_PLAN],
    ["Owner Consent Form", ComplianceDocumentType.OWNER_CONSENT_FORM],
  ];

  for (const [label, expected] of cases) {
    assert.equal(
      checklistDocumentType(line(label)),
      expected,
      `"${label}" should read as ${expected}`,
    );
  }
});

// ---------------------------------------------------------------------------
// What must not match
// ---------------------------------------------------------------------------

test("a preliminary set does not answer a line asking for the full design", () => {
  // The mistake that would matter most. A certifier asking for architectural
  // drawings means the set the job is assessed on, and answering it with the
  // sketch set the architect produced first looks answered and is not — which
  // is worse than leaving the row empty.
  // Asserted as an equality rather than an inequality. `notEqual` catches a
  // regression back to the preliminary set and passes just as happily on null
  // or on some third type, either of which is its own bug: the checklist
  // contract is that this line resolves to the full design.
  assert.equal(
    checklistDocumentType(line("Preliminary architectural plans")),
    ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
  );
  assert.equal(
    isChecklistMappableType(
      ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    ),
    false,
  );
});

test("a stormwater plan does not read as architectural drawings", () => {
  assert.equal(
    checklistDocumentType(line("Stormwater plan")),
    ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS,
  );
});

test("a line naming nothing we track resolves to nothing", () => {
  for (const label of [
    "Notice of commencement",
    "Please email these to our office",
    "",
  ]) {
    assert.equal(
      checklistDocumentType(line(label)),
      null,
      `"${label}" should not resolve to a type`,
    );
  }
});

// ---------------------------------------------------------------------------
// What the mapped row says about itself
// ---------------------------------------------------------------------------

test("every mappable type can say where it came from", () => {
  // The provenance line is the whole reason an automatic mapping is acceptable
  // rather than alarming: six rows answering themselves needs to be six rows
  // saying which document answered them. A type with no source sentence would
  // render as a bare filename indistinguishable from a manual upload.
  for (const type of CHECKLIST_MAPPABLE_TYPES) {
    const source = mappedDocumentSource(type);
    assert.ok(source.trim(), `${type} has no source sentence`);
    // Reads mid-sentence — "Already on the file, from the surveyor." — so it
    // must not open with a capital. Acronyms inside it are fine and expected:
    // "the project's HBCF cover" is the name of the thing.
    assert.equal(
      source[0],
      source[0].toLowerCase(),
      `${type}'s source reads mid-sentence, so it should not open with a capital`,
    );
  }
});
