import assert from "node:assert/strict";

import { describe, test } from "vitest";

import { DomainStaleVersionError } from "@/lib/domain/errors";
import type { ChecklistDocumentData } from "@/lib/domain/ports/checklist";
import { exportChecklistDocument } from "@/lib/domain/projects/checklist-export";
import { buildChecklistDocumentHtml } from "@/lib/projects/checklist-document-html";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";
import { SIGNATURE, base, openChecklist } from "./checklist-fixtures";

// The downloaded checklist (issue #420): a draft can never pass for a final
// document, and an export is recorded against the revision it printed.

describe("the downloaded checklist", () => {
  const exportRow = (status: "OPEN" | "CLOSED") => ({
    closedAt: status === "CLOSED" ? new Date("2026-11-10T00:00:00Z") : null,
    comments: "Touch-ups done",
    checkedBy: "Gurpinder",
    issues: [],
    items: [
      {
        id: "it_1",
        label: "Front screen door",
        naReason: null,
        section: "Entry",
        state: "CHECKED",
      },
    ],
    number: 6,
    project: {
      buildingType: "Double Storey",
      location: "12 Smith St",
      name: "Smith Residence",
    },
    stage: "Final",
    status,
    title: "Handover Checklist",
    version: 9,
  });

  const run = async (
    status: "OPEN" | "CLOSED",
    /** The revision found when recording, after the render. */
    currentVersion = 9,
  ) => {
    let printed: ChecklistDocumentData | null = null;
    const recorder = recordingDb({
      ...base,
      "projectChecklist.findFirst": { ...openChecklist, status },
      "projectChecklist.findFirstOrThrow": exportRow(status),
      "projectChecklist.findUnique": { version: currentVersion },
      "checklistSignature.create": { id: "s_1" },
      "checklistExport.create": { id: "e_1" },
    });
    const exported = await exportChecklistDocument(
      adminPrincipal(),
      {
        checklistId: "c_6",
        projectId: "p_1",
        reviewerName: "Gurpinder",
        signatureDataUrl: SIGNATURE,
      },
      recorder.transactionalDb,
      async (document) => {
        printed = document;
        return new Uint8Array([1]);
      },
    );
    return {
      exported,
      printed: printed as unknown as ChecklistDocumentData,
      recorder,
    };
  };

  test("an open checklist downloads as a draft, and downloading does not close it", async () => {
    const { exported, printed, recorder } = await run("OPEN");
    assert.equal(exported.final, false);
    assert.match(exported.filename, /-DRAFT\.pdf$/);
    assert.equal(printed.final, false);
    assert.ok(
      recorder
        .writes()
        .every((write) => !write.operation.startsWith("projectChecklist.")),
    );
    const html = buildChecklistDocumentHtml(printed);
    assert.match(html, /Draft – inspection in progress, not closed/);
    assert.match(html, /DRAFT<\/div>/);
    assert.doesNotMatch(html, /Final – closed/);
  });

  test("a closed checklist downloads as final, with the header fields and the signature", async () => {
    const { exported, printed } = await run("CLOSED");
    assert.equal(exported.final, true);
    assert.doesNotMatch(exported.filename, /DRAFT/);
    const html = buildChecklistDocumentHtml(printed);
    assert.match(html, /Final – closed/);
    assert.match(html, /Project Address:<\/td><td>12 Smith St/);
    assert.match(html, /House Type:<\/td><td>Double Storey/);
    assert.match(html, /Name of the Reviewer<\/span>Gurpinder/);
    assert.ok(html.includes(SIGNATURE));
    assert.doesNotMatch(html, /class="watermark"/);
  });

  test("an empty checklist prints as a blank template, never as inspected", () => {
    const html = buildChecklistDocumentHtml({
      checkedBy: null,
      checklistNumber: 2,
      checklistTitle: "Slab Checklist",
      closedAt: null,
      comments: null,
      configured: false,
      final: false,
      houseType: "Single Storey",
      issues: [],
      projectAddress: "1 Test Rd",
      projectName: "Test",
      reviewerName: "Gurpinder",
      sections: [],
      signatureDataUrl: SIGNATURE,
      signedAt: new Date("2026-11-12T00:00:00Z"),
      stageLabel: "Slab",
      version: 1,
    });
    assert.match(html, /Blank template – not configured/);
    assert.match(html, /records nothing as inspected or completed/);
  });

  test("records the revision and status it printed, together", async () => {
    const { recorder } = await run("CLOSED");
    const writes = recorder.writes();
    assert.deepEqual(
      writes.map((write) => write.operation),
      ["checklistSignature.create", "checklistExport.create"],
    );
    const record = writes[1].args as {
      data: { final: boolean; statusAtExport: string; version: number };
    };
    assert.equal(record.data.final, true);
    assert.equal(record.data.statusAtExport, "CLOSED");
    assert.equal(record.data.version, 9);
  });

  test("is refused, and records nothing, if the checklist moved while it rendered", async () => {
    await assert.rejects(() => run("OPEN", 10), DomainStaleVersionError);
  });
});
