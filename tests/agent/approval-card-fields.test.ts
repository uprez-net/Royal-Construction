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
  // A reassignment's target is part of what is being approved.
  assert.equal(
    changes?.value,
    "Stage → Qualified · Followup Date → (cleared) · Assigned User → u1",
  );
});

test("an id inside a set of changes reads as its record's name when known", () => {
  const fields = toInputFields(
    { changes: { stage: "Qualified", tradieId: "t1" } },
    { changeLabels: { tradieId: "AR Electrical" } },
  );
  assert.equal(fields[0]?.value, "Stage → Qualified · Tradie → AR Electrical");
});

test("hideIds leaves ids out of a set of changes too", () => {
  const [changes] = toInputFields(
    { changes: { stage: "Qualified", assignedUserId: "u1" } },
    { hideIds: true },
  );
  assert.equal(changes?.value, "Stage → Qualified");
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

test("a bulk update is shown one line per record, named when the name is known (#616)", () => {
  const input = {
    projectId: "p1",
    updates: [
      { milestoneId: "m1", startDate: "2026-12-01", status: "PENDING" },
      { milestoneId: "m2", startDate: "2026-12-08", status: "PENDING" },
    ],
  };
  const named = toInputFields(input, {
    itemLabels: { updates: ["Slab pour", undefined] },
  }).find((field) => field.key === "updates");
  assert.ok(named);
  assert.equal(named.prose, true);
  const [first, second] = named.value.split("\n");
  assert.match(first ?? "", /^Slab pour: /);
  assert.doesNotMatch(first ?? "", /m1/, "a named record hides its id");
  assert.match(second ?? "", /^2\. Milestone → m2/);
  assert.match(second ?? "", /Status → PENDING/i);
});
