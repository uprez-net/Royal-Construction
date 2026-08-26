import assert from "node:assert/strict";
import { test } from "node:test";

import { LEAD_SUBJECT_LINES, LEAD_SUBJECT_PATTERNS, isLeadSubject, normalizeSubject } from "../../lib/graph/lead-subject";

test("the quoted 'I want to build' subject creates a lead", () => {
  // The regression: the allowlist held the quoted form while the normalizer
  // stripped quotes, so every enquiry from this form was skipped in silence.
  assert.equal(isLeadSubject('"I want to build" Form Submission'), true);
  assert.equal(isLeadSubject('"i want to build" form submission'), true);
  assert.equal(isLeadSubject("I want to build Form Submission"), true);
  // Curly quotes as Outlook and Word actually send them — NOT pre-stripped,
  // which is what the first version of this test did, proving nothing.
  assert.equal(isLeadSubject("“I want to build” Form Submission"), true);
  assert.equal(isLeadSubject("‘I want to build’ Form Submission"), true);
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

test("a Custom Build Quote subject creates a lead", () => {
  for (const s of [
    "Custom Build Quote",
    "Custom Build Quote - Fairfield East",
    "custom build quote",
    "CUSTOM BUILD QUOTE",
    "Custom-Build Quote",
    // The phrase carries the subject even when the customer adds their own
    // words around it, which is why this layer matches on containment.
    "Custom Build Quote request for 12 Smith St",
    "Website: Custom Build Quote",
    "“Custom Build Quote”",
    "  Custom   Build   Quote  ",
  ]) {
    assert.equal(isLeadSubject(s), true, s);
  }
});

test("a customer asking a builder for a price creates a lead", () => {
  for (const s of [
    "Quote for a new home build",
    "Quote request - knockdown rebuild",
    "Granny flat estimate",
    "Renovation costing",
    "Pricing for a duplex",
    "Estimate for house and land",
    "Quotation for an extension",
  ]) {
    assert.equal(isLeadSubject(s), true, s);
  }
});

test("a customer enquiring about a build creates a lead", () => {
  for (const s of [
    "Enquiry about building a duplex",
    "Inquiry - new home",
    "Looking to build in Kellyville",
    "Interested in a granny flat",
    "Extension request",
    "Townhouse enquiries",
  ]) {
    assert.equal(isLeadSubject(s), true, s);
  }
});

test("generic first-contact subjects create a lead", () => {
  for (const s of [
    "Website Enquiry",
    "New online inquiry",
    "New lead from Houzz",
    "New customer via the website",
  ]) {
    assert.equal(isLeadSubject(s), true, s);
  }
});

test("build words alone are not an enquiry", () => {
  // Each of these hits one vocabulary but not a second, so it must not match.
  // A subject that merely says "build" is as likely a build failure notice.
  for (const s of [
    "Build 1234 failed",
    "Build pipeline succeeded",
    "Renovation photos attached",
    "Quote from Bunnings for timber",
    "Please estimate the delivery date",
    "Your request has been received",
    "Site inspection Tuesday",
  ]) {
    assert.equal(isLeadSubject(s), false, s);
  }
});

test("replies and forwards are a live thread, not a new lead", () => {
  // The patterns match anywhere in the subject, so without the reply guard
  // every message in a thread would open a second lead for the same customer.
  for (const s of [
    "Re: Custom Build Quote",
    "RE: Custom Build Quote",
    "Fw: Custom Build Quote",
    "FWD: Quote for a new home build",
    "Re: Re: Website Enquiry",
    "Re[2]: Granny flat estimate",
    // The exact allowlist behaved this way already — this pins that it still does.
    "Re: Get in touch Form Submission",
  ]) {
    assert.equal(isLeadSubject(s), false, s);
  }
});

test("patterns are stateless across calls", () => {
  // A `g` or `y` flag on a module-level regex keeps `lastIndex` between calls,
  // so the second identical message would be skipped. The module rejects those
  // flags at load; this proves the behaviour they would break.
  for (const pattern of LEAD_SUBJECT_PATTERNS) {
    assert.equal(pattern.global, false, `${pattern} uses the g flag`);
    assert.equal(pattern.sticky, false, `${pattern} uses the y flag`);
  }
  for (let i = 0; i < 3; i++) {
    assert.equal(isLeadSubject("Custom Build Quote"), true, `call ${i}`);
    assert.equal(isLeadSubject("Quote for a new home build"), true, `call ${i}`);
  }
});

test("no pattern lost a word boundary to template-literal escaping", () => {
  // `\b` inside a plain template literal is a backspace character, not a word
  // boundary — the pattern still reads correctly but stops matching. The
  // composed patterns use String.raw; this is the test for it.
  for (const pattern of LEAD_SUBJECT_PATTERNS) {
    assert.equal(
      pattern.source.includes(String.fromCharCode(8)),
      false,
      `${pattern} contains a literal backspace`,
    );
  }
});

test("project administration on a live job is not a new lead", () => {
  // `BUILD_WORK` holds bare nouns and `ENQUIRY` holds the bare word "request",
  // so before the PROJECT_ADMIN veto every one of these matched: a certifier,
  // a council officer and a supplier each got a Lead row AND the automated
  // "Welcome to Royal Constructions" email. The earlier negative test could not
  // catch this class — each of its cases is missing one vocabulary entirely,
  // whereas these carry both and are still plainly not a new customer.
  for (const s of [
    "Variation request - extension at 12 Smith St",
    "Inspection request - duplex at 4 Jones Ave",
    "Council: request for further information, extension DA-2024-119",
    "Payment request - renovation stage 3",
    "Purchase order 8891 - townhouse tiling quote",
    "Supplier quote - duplex windows",
    "Estimate revision for the extension - internal",
    "Progress claim 4 - duplex at 4 Jones Ave, quote attached",
    "Remittance advice - renovation final account",
    "Defect list for the townhouse handover",
  ]) {
    assert.equal(isLeadSubject(s), false, s);
  }
});

test("the veto does not swallow a genuine first approach", () => {
  // The counterpart to the test above: widening PROJECT_ADMIN must not start
  // rejecting the customer phrasings the patterns exist to catch.
  for (const s of [
    "Custom Build Quote",
    "Quote for a new home",
    "Granny flat estimate",
    "Renovation costing",
    "Enquiry about building a duplex",
    "Looking to build",
    "Extension request",
    "I'm interested in a knockdown rebuild",
  ]) {
    assert.equal(isLeadSubject(s), true, s);
  }
});

test("an oversized subject is refused instead of scanned", () => {
  // The composed patterns pair two vocabularies across a gap. Against a long
  // subject carrying many BUILD_WORK words but no second vocabulary, every
  // start position drove the gap to the end and backtracked: 64KB cost ~3.2s
  // of blocking CPU inside the Graph notification handler, which is an
  // unauthenticated path — anyone can email the public business address.
  const hostile = "new house build ".repeat(4096); // 64KB, no second vocabulary
  const started = process.hrtime.bigint();
  assert.equal(isLeadSubject(hostile), false);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 50, `scan took ${elapsedMs.toFixed(0)}ms, expected < 50ms`);

  // The cap must not be doing the work a real subject depends on.
  assert.equal(isLeadSubject("Quote for a new home"), true);
});
