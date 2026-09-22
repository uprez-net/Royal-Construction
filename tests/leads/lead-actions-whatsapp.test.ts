import assert from "node:assert/strict";
import { test } from "vitest";

import { leadActions } from "@/lib/leads/lead-actions";
import type { Lead } from "@/lib/leads/types";

// The WhatsApp action's gate (issue #333). One function decides it for the
// desktop row, the mobile card and the lead page, so asserting the function
// is asserting all three; tests/leads/whatsapp-wiring.test.ts checks that
// each surface actually reads it.

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    assignedId: null,
    budget: "Not Discussed",
    created: "2026-09-01T00:00:00.000Z",
    creatingOffer: false,
    email: "sam@example.com",
    emails: [],
    followupDate: null,
    followupNotes: "",
    followupTime: null,
    history: [],
    id: 42,
    isArchived: false,
    location: "Kellyville",
    name: "Sam Lead",
    notes: "",
    phone: "0412 345 678",
    runId: null,
    runStatus: null,
    source: "Website",
    sourceDetail: "Website",
    stage: "Contacted",
    type: "New Home",
    uploadedFiles: [],
    urgent: false,
    ...overrides,
  };
}

test("a lead whose phone normalises can open WhatsApp", () => {
  const state = leadActions(lead()).whatsapp;
  assert.deepEqual(state, {
    disabled: false,
    disabledReason: null,
    visible: true,
  });
});

test("an international number with its country code is usable", () => {
  assert.equal(
    leadActions(lead({ phone: "+44 7911 123456" })).whatsapp.disabled,
    false,
  );
});

test("no phone: the action shows, blocked, and says why", () => {
  const state = leadActions(lead({ phone: "" })).whatsapp;
  assert.equal(state.visible, true);
  assert.equal(state.disabled, true);
  assert.match(state.disabledReason ?? "", /no phone number/i);
});

test("digits are not enough: an incomplete number is blocked with a reason", () => {
  for (const phone of ["0412 345", "call after 5pm", "12345678901234567"]) {
    const state = leadActions(lead({ phone })).whatsapp;
    assert.equal(state.disabled, true, phone);
    assert.match(state.disabledReason ?? "", /not a complete, valid number/i, phone);
  }
});

test("archived beats a good phone, and says archived", () => {
  const state = leadActions(lead({ isArchived: true })).whatsapp;
  assert.equal(state.visible, true);
  assert.equal(state.disabled, true);
  assert.match(state.disabledReason ?? "", /archived/i);
});

test("the email thread keeps its own gate and is independent of WhatsApp", () => {
  const noEmail = leadActions(lead({ email: "" }));
  assert.equal(noEmail.sendText.visible, false);
  assert.equal(noEmail.whatsapp.disabled, false);
});
