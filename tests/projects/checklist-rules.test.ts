import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  canMoveIssue,
  checklistDisplayStatus,
  checklistProgress,
  isValidSignatureDataUrl,
} from "@/lib/domain/projects/checklist-rules";
import { ensureProjectChecklists } from "@/lib/domain/projects/checklist-setup";
import {
  CHECKLIST_STAGES,
  HANDOVER_TEMPLATE_KEY,
  checklistDefinition,
  checklistNumberForStage,
  templateItems,
  tradesForItem,
} from "@/lib/domain/projects/checklist-templates";

import { recordingDb } from "../architecture/domain-harness";
import { SIGNATURE } from "./checklist-fixtures";

// Project checklists (issue #420): the handover inventory exactly as the
// client's document has it, the six stage checklists, and the pure rules the
// screen and the server share.

describe("the handover template", () => {
  const items = templateItems(HANDOVER_TEMPLATE_KEY);

  test("has every row of the client's document: 95 rows in 17 rooms", () => {
    assert.equal(items.length, 95);
    const sections = [...new Set(items.map((item) => item.section))];
    assert.deepEqual(sections, [
      "Entry",
      "Hallway",
      "Lounge",
      "Dining",
      "Family",
      "Kitchen",
      "Main bed",
      "Bathrooms, en-suites, and toilets",
      "Bed 2",
      "Bed 3",
      "Bed 4",
      "Bed 5/Study",
      "Other Rooms",
      "Patio/verandah",
      "Garden shed or storage",
      "External house",
      "Other",
    ]);
    const count = (section: string) =>
      items.filter((item) => item.section === section).length;
    assert.equal(count("Kitchen"), 7);
    assert.equal(count("Bathrooms, en-suites, and toilets"), 7);
    assert.equal(count("Patio/verandah"), 4);
    assert.equal(count("Other"), 1);
  });

  test("keeps the source wording, and every row has a stable unique key", () => {
    const labels = items.map((item) => item.label);
    assert.ok(labels.includes("Front screen door"));
    assert.ok(
      labels.includes(
        "All appliances, including stove/cooktop/oven, rangehood, dishwasher, insinkerator, etc",
      ),
    );
    assert.ok(labels.includes("Light fittings, GPO’s, exhaust fans"));
    assert.ok(
      labels.includes(
        "Eves, gutters on lowset residences, downpipes and stormwater drain",
      ),
    );
    const keys = new Set(items.map((item) => item.key));
    assert.equal(keys.size, items.length);
    assert.deepEqual(
      items.map((item) => item.order),
      items.map((_, index) => index),
    );
  });

  test("names the likely trades, and none for the bins", () => {
    assert.ok(
      tradesForItem(
        HANDOVER_TEMPLATE_KEY,
        "kitchen.sink-plugs-and-plugholes",
      ).includes("Plumbing"),
    );
    assert.deepEqual(tradesForItem(HANDOVER_TEMPLATE_KEY, "other.bins"), []);
  });
});

describe("the six stage checklists", () => {
  test("checklist N verifies stage N, and only the sixth has rows", () => {
    assert.equal(CHECKLIST_STAGES.length, 6);
    for (let number = 1; number <= 5; number += 1) {
      const definition = checklistDefinition(number);
      assert.equal(templateItems(definition.templateKey).length, 0);
      assert.equal(checklistNumberForStage(definition.stage), number);
    }
    const handover = checklistDefinition(6);
    assert.equal(handover.stage, "Final");
    assert.equal(handover.title, "Handover Checklist");
    assert.equal(checklistNumberForStage("Final"), 6);
    assert.throws(() => checklistDefinition(7), RangeError);
  });

  test("creates the six and copies the handover rows, without duplicates", async () => {
    let created = false;
    const recorder = recordingDb({
      "projectChecklist.findMany": () =>
        created
          ? Array.from({ length: 6 }, (_, index) => ({
              _count: { items: 0 },
              id: `c_${index + 1}`,
              number: index + 1,
              templateKey: checklistDefinition(index + 1).templateKey,
            }))
          : [],
      "projectChecklist.createMany": () => {
        created = true;
        return { count: 6 };
      },
    });
    await ensureProjectChecklists("p_1", recorder.db);
    const writes = recorder.writes();
    assert.deepEqual(
      writes.map((write) => write.operation),
      ["projectChecklist.createMany", "checklistItem.createMany"],
    );
    const checklists = writes[0].args as {
      data: { number: number }[];
      skipDuplicates: boolean;
    };
    assert.equal(checklists.data.length, 6);
    assert.equal(checklists.skipDuplicates, true);
    const rows = writes[1].args as {
      data: { checklistId: string }[];
      skipDuplicates: boolean;
    };
    assert.equal(rows.data.length, 95);
    assert.ok(rows.data.every((row) => row.checklistId === "c_6"));
    assert.equal(rows.skipDuplicates, true);
  });
});

describe("progress and signatures", () => {
  test("counts reviewed rows and blocking issues", () => {
    const progress = checklistProgress(
      [
        { id: "a", state: "CHECKED" },
        { id: "b", state: "NOT_APPLICABLE" },
        { id: "c", state: "UNCHECKED" },
      ],
      [
        { id: "i", itemId: "a", status: "RESOLVED" },
        { id: "j", itemId: "a", status: "VERIFIED" },
      ],
    );
    assert.equal(progress.reviewed, 2);
    assert.equal(progress.openIssues, 1);
    assert.equal(progress.awaitingVerification, 1);
    assert.equal(checklistDisplayStatus("OPEN", progress), "in_progress");
    assert.equal(
      checklistDisplayStatus("OPEN", checklistProgress([], [])),
      "not_configured",
    );
  });

  test("only a PNG data URL of sensible size is a signature", () => {
    assert.equal(isValidSignatureDataUrl(SIGNATURE), true);
    assert.equal(
      isValidSignatureDataUrl("data:image/svg+xml;base64,AAAA"),
      false,
    );
    assert.equal(isValidSignatureDataUrl("https://example.com/sig.png"), false);
    assert.equal(
      isValidSignatureDataUrl(`data:image/png;base64,${"A".repeat(300_000)}`),
      false,
    );
  });
});

describe("the issue state machine", () => {
  test("verified is reached only from resolved, and a reopen goes back to open", () => {
    assert.equal(canMoveIssue("OPEN", "VERIFIED"), false);
    assert.equal(canMoveIssue("IN_PROGRESS", "VERIFIED"), false);
    assert.equal(canMoveIssue("RESOLVED", "VERIFIED"), true);
    assert.equal(canMoveIssue("VERIFIED", "OPEN"), true);
    assert.equal(canMoveIssue("VERIFIED", "RESOLVED"), false);
  });
});
