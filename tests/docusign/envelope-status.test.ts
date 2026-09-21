import assert from "node:assert/strict";
import { test } from "node:test";

import { EnvelopeStatus } from "@prisma/client";

import {
  envelopeStatusRank,
  isLiveEnvelopeStatus,
  readRefusedVoid,
} from "../../lib/docusign/envelope-status";

// Recall and Create revision only looked for envelopes with status SENT. The
// Connect webhook moves an envelope to DELIVERED as soon as the customer opens
// the signing link, so the usual case, a customer who has already looked at the
// document, matched nothing. Both actions reported success and voided nothing,
// and the customer could still sign.

const TERMINAL: EnvelopeStatus[] = [
  EnvelopeStatus.COMPLETED,
  EnvelopeStatus.DECLINED,
  EnvelopeStatus.VOIDED,
];

test("an envelope the customer has opened is still live", () => {
  assert.equal(isLiveEnvelopeStatus(EnvelopeStatus.DELIVERED), true);
});

test("created and sent envelopes are live", () => {
  assert.equal(isLiveEnvelopeStatus(EnvelopeStatus.CREATED), true);
  assert.equal(isLiveEnvelopeStatus(EnvelopeStatus.SENT), true);
});

test("completed, declined and voided envelopes are not live", () => {
  for (const status of TERMINAL) {
    assert.equal(
      isLiveEnvelopeStatus(status),
      false,
      `${status} treated as live`,
    );
  }
});

test("every envelope status is either live or terminal", () => {
  // A status added to the enum must be placed on one side deliberately.
  for (const status of Object.values(EnvelopeStatus)) {
    assert.notEqual(
      isLiveEnvelopeStatus(status),
      TERMINAL.includes(status),
      `${status} is neither live nor terminal, or is both`,
    );
  }
});

test("rank only moves forward: sent, then delivered, then any terminal status", () => {
  assert.ok(
    envelopeStatusRank(EnvelopeStatus.SENT) <
      envelopeStatusRank(EnvelopeStatus.DELIVERED),
  );
  for (const status of TERMINAL) {
    assert.ok(
      envelopeStatusRank(EnvelopeStatus.DELIVERED) < envelopeStatusRank(status),
      `${status} does not outrank DELIVERED`,
    );
  }
});

test("no live status outranks a terminal one", () => {
  // Otherwise a late "sent" or "delivered" event could reopen a finished envelope.
  for (const live of [
    EnvelopeStatus.CREATED,
    EnvelopeStatus.SENT,
    EnvelopeStatus.DELIVERED,
  ]) {
    for (const terminal of TERMINAL) {
      assert.ok(envelopeStatusRank(live) < envelopeStatusRank(terminal));
    }
  }
});

// Recall and Create revision treated every refused void as an envelope still out
// for signature. DocuSign also refuses to void one that already expired or was
// declined, and when that Connect event never arrived the row stayed live: both
// actions were refused for good, and voiding it by hand was impossible.

test("a refused void on an envelope DocuSign has voided or declined counts as ended", () => {
  assert.deepEqual(readRefusedVoid("voided"), {
    kind: "ended",
    status: EnvelopeStatus.VOIDED,
  });
  assert.deepEqual(readRefusedVoid("Voided"), {
    kind: "ended",
    status: EnvelopeStatus.VOIDED,
  });
  assert.deepEqual(readRefusedVoid("declined"), {
    kind: "ended",
    status: EnvelopeStatus.DECLINED,
  });
});

test("a refused void on an envelope the customer signed never counts as ended", () => {
  for (const status of ["signed", "completed"]) {
    assert.deepEqual(readRefusedVoid(status), { kind: "signed" }, status);
  }
});

test("any other status DocuSign reports counts as still out for signature", () => {
  for (const status of [
    "sent",
    "delivered",
    "created",
    "correct",
    "a-status-added-later",
    "",
    null,
    undefined,
  ]) {
    assert.deepEqual(
      readRefusedVoid(status),
      { kind: "still-out" },
      `${String(status)} was not treated as still out`,
    );
  }
});
