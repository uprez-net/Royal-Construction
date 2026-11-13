import assert from "node:assert/strict";
import { test } from "vitest";

import { toInputFields } from "@/components/agent/agent-format";

// #429: the approval card for "move the Uppal lead to Qualified" showed
// `{ "stage": "Qualified" }` under a field labelled "Lead Id".

test("an id field is labelled by the record it points at", () => {
  const [lead] = toInputFields({ leadId: 100 });
  assert.equal(lead?.label, "Lead");
  const [projects] = toInputFields({ affectedProjectIds: ["a", "b"] });
  assert.equal(projects?.label, "Affected Project");
});

test("a set of changes reads as field → value", () => {
  const fields = toInputFields({
    leadId: 100,
    changes: { stage: "Qualified", followupDate: null, assignedUserId: "u1" },
  });
  const changes = fields.find((field) => field.key === "changes");
  assert.equal(changes?.value, "Stage → Qualified · Followup Date → (cleared)");
});

test("a status code reads as words", () => {
  const [status] = toInputFields({ status: "TENDER_SENT" });
  assert.equal(status?.value, "Tender sent");
  const [gst] = toInputFields({ note: "GST" });
  assert.equal(gst?.value, "GST");
});

test("hideIds leaves record ids out of a card that cannot name them", () => {
  const fields = toInputFields(
    { leadId: 105, query: "Sandhu", id: "x" },
    { hideIds: true },
  );
  assert.deepEqual(
    fields.map((field) => field.key),
    ["query"],
  );
});
