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

test("vendors selling to the builder are not leads", () => {
  // What this mailbox actually receives. An audit of 800 real messages found
  // trades, recruiters and suppliers outnumber customers, and they write in the
  // customer's vocabulary — the first two below reached the patterns and each
  // created a lead plus an automated welcome email to a cold outreach sender.
  for (const s of [
    "Construction Project Takeoff & Cost Estimate",
    "Bid Request For Building Project",
    "Draftsman looking for work",
    "Your New Remote Construction Estimator",
    "Traffic Control • Cleaner Construction • General Labour Hire",
    "Cleaning & Silicone Services – Trade Partnership with Royal Construction",
    "Cadetship Inquiry – 1st Year Construction Management Student",
    "AtoZ Construction Engineering Formwork - Request For Tender Opportunities",
    "Flexible Construction Finance for Builders & Developers",
  ]) {
    assert.equal(isLeadSubject(s), false, s);
  }
});

test("our own outbound coming back is not a new lead", () => {
  // These arrive at info@ as a cc or self-copy. They are written to customers,
  // so they carry a build word and often a street address — the exact shape of
  // a genuine enquiry. Untreated they open a second lead for a customer who
  // already has one. Stems are sourced from the send sites.
  for (const s of [
    "Your Building Offer — Lot 8358 Expedition Loop, Oran Park",
    "Your Building Proposal — RC-Q-2026-011-R1 [RCOFR-DA31C8C86922]",
    "Welcome to Royal Constructions — Your Home Building Journey Starts Here",
    "Following up on your Double Storey, Granny Flat in Lot 3100 in Orchard Hills",
    "Quotation next steps for Jane - Oran Park duplex ($840,000)",
  ]) {
    assert.equal(isLeadSubject(s), false, s);
  }
});

test("bounces and autoresponders are not leads", () => {
  // A bounce carries the subject of whatever triggered it, so it inherits that
  // subject's vocabulary. The audit found five in 800 — including a bounce of
  // this system's own welcome email. "Undeliverable: Request for Quotation -
  // 145 Oran Park Dr" already carries both "request" and "quotation" and missed
  // only because no build noun happened to appear.
  for (const s of [
    "Undeliverable: Welcome to Royal Constructions — Your Home Building Journey Starts Here",
    "Undeliverable: Request for Quotation – 145 Oran Park Dr, Oran Park NSW 2570, Australia Project",
    "Automatic reply: Quote for a new home",
    "Out of office: Granny flat estimate",
    "Mail delivery failed: returning message to sender",
  ]) {
    assert.equal(isLeadSubject(s), false, s);
  }
});

test("a customer stating the job plainly is a lead", () => {
  // Real subjects from the audit that the pattern layer dropped. Each carries
  // only ONE vocabulary, and the paired patterns need two, so the most explicit
  // enquiries a person can write were the ones that missed. A lost customer
  // costs more than a junk lead.
  for (const s of [
    "I want to build a Granny Flat in Cherrybrook",
    "New build",
    "13 Binalog Road, Pendle Hill - New Build",
    "We are looking to renovate",
    "Wanting to build in Oran Park",
  ]) {
    assert.equal(isLeadSubject(s), true, s);
  }
});

test("the vetoes do not swallow a genuine first approach", () => {
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
