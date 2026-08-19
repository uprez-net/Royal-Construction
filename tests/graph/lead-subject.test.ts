import assert from "node:assert/strict";
import { test } from "node:test";

import { LEAD_SUBJECT_LINES, isLeadSubject, normalizeSubject } from "../../lib/graph/lead-subject";

test("the quoted 'I want to build' subject creates a lead", () => {
  // The regression: the allowlist held the quoted form while the normalizer
  // stripped quotes, so every enquiry from this form was skipped in silence.
  assert.equal(isLeadSubject('"I want to build" Form Submission'), true);
  assert.equal(isLeadSubject('"i want to build" form submission'), true);
  assert.equal(isLeadSubject("I want to build Form Submission"), true);
  // Curly quotes as Outlook and Word actually send them — NOT pre-stripped,
  // which is what the first version of this test did, proving nothing.
  assert.equal(isLeadSubject("\u201CI want to build\u201D Form Submission"), true);
  assert.equal(isLeadSubject("\u2018I want to build\u2019 Form Submission"), true);
});

test("the other website forms still match", () => {
  for (const s of [
    "Get in touch Form Submission",
    "General Enquiry Form Submission",
    "New message from Royal Constructions",
  ]) {
    assert.equal(isLeadSubject(s), true, s);
  }
});

test("unrelated mail is still ignored", () => {
  for (const s of ["Re: invoice 123", "", null, undefined, "form submission"]) {
    assert.equal(isLeadSubject(s), false, String(s));
  }
});

test("subjects match despite case, padding and repeated spaces", () => {
  assert.equal(isLeadSubject("  GET IN   TOUCH   form submission  "), true);
});

test("every allowlist entry is itself normalized", () => {
  // An entry that is not already normalized can never match. The module
  // asserts this at load; this pins it as a test too.
  for (const line of LEAD_SUBJECT_LINES) {
    assert.equal(normalizeSubject(line), line, `"${line}" is not normalized`);
  }
});