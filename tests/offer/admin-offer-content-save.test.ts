import assert from "node:assert/strict";
import { test } from "node:test";

import {
  markSectionEdited,
  saveReceipt,
  settleSavedSection,
} from "../../lib/store/slices/admin-offer-content-save";

// An admin offer-content save sends a snapshot, and the editors stay live while
// it is in flight. The fulfilled handler cleared the section's dirty flag
// unconditionally, so a delete undone, or a field typed, during the round trip
// was marked saved: Save disabled, closing the tab did not warn, and the next
// page mount replaced the edit with the server copy. These pin the rule that
// replaced it: a save only marks the section clean if nothing changed since
// its snapshot.

const flags = <T>(value: T) => ({
  buildScope: value,
  costSchedule: value,
  offerScope: value,
  offerContent: value,
  hbfcClaim: value,
});

function freshState() {
  return {
    dirty: flags(false),
    saving: flags(false),
    error: flags<string | null>(null),
    revision: flags(0),
  };
}

test("an edit marks its section dirty, clears its error and bumps only its revision", () => {
  const state = freshState();
  state.error.costSchedule = "Failed to save cost schedule.";

  markSectionEdited(state, "costSchedule");

  assert.equal(state.dirty.costSchedule, true);
  assert.equal(state.error.costSchedule, null);
  assert.equal(state.revision.costSchedule, 1);
  assert.equal(state.revision.offerScope, 0);
  assert.equal(state.dirty.offerScope, false);
});

test("a save with no edits since its snapshot marks the section clean", () => {
  const state = freshState();
  markSectionEdited(state, "costSchedule");
  state.saving.costSchedule = true;
  const sentRevision = state.revision.costSchedule;

  const receipt = saveReceipt(state, "costSchedule", sentRevision);
  settleSavedSection(state, "costSchedule", sentRevision);

  assert.deepEqual(receipt, { sentRevision, newerEdits: false });
  assert.equal(state.saving.costSchedule, false);
  assert.equal(state.dirty.costSchedule, false);
});

test("an edit made while the save was in flight keeps the section dirty", () => {
  const state = freshState();
  markSectionEdited(state, "costSchedule"); // remove the Slab task
  state.saving.costSchedule = true;
  const sentRevision = state.revision.costSchedule; // Save pressed

  markSectionEdited(state, "costSchedule"); // Undo pressed before it resolves

  const receipt = saveReceipt(state, "costSchedule", sentRevision);
  settleSavedSection(state, "costSchedule", sentRevision);

  assert.deepEqual(receipt, { sentRevision, newerEdits: true });
  assert.equal(state.saving.costSchedule, false);
  assert.equal(state.dirty.costSchedule, true);
});

test("an edit to another section during the save does not keep this one dirty", () => {
  const state = freshState();
  markSectionEdited(state, "offerContent");
  state.saving.offerContent = true;
  const sentRevision = state.revision.offerContent;

  markSectionEdited(state, "hbfcClaim");
  settleSavedSection(state, "offerContent", sentRevision);

  assert.equal(state.dirty.offerContent, false);
  assert.equal(state.dirty.hbfcClaim, true);
});
