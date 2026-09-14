import assert from "node:assert/strict";
import { test } from "node:test";

import { OfferStatus } from "@prisma/client";

import {
  envelopeScopeFilter,
  resolveRecall,
} from "../../lib/offer/offer-recall";
import {
  OFFER_WORKFLOW_TRANSITIONS,
  RECALL_EDGES,
  classifyOfferTransition,
  requiresOwnerGate,
} from "../../lib/offer/offer-workflow-transitions";

// recallOfferEnvelope is a Server Action, so every argument comes from the
// client. It trusted `scope`: a string outside "offer" | "tender" | "contract"
// fell out of envelopeScopeFilter as undefined, Prisma dropped `OR: undefined`,
// and the void query matched every live envelope in the database. One call
// could void every document out for signature, for every customer. It also
// moved the offer to whatever `toStatus` it was sent. Separately, the generic
// transitionOfferStatus could step a *_SENT offer back to draft without voiding
// anything, which is the defect Recall was built to fix.

test("a recall refuses any scope that is not the document out for signature", () => {
  for (const scope of ["all", "bogus", undefined, {}, "toString", "offer", "contract"]) {
    const result = resolveRecall(
      scope,
      OfferStatus.TENDER_DRAFT,
      OfferStatus.TENDER_SENT,
      true,
    );
    assert.equal(result.ok, false, `scope ${String(scope)} was accepted`);
  }
});

test("a recall refuses when nothing is out for signature", () => {
  const atDraft = resolveRecall(
    "tender",
    OfferStatus.TENDER_DRAFT,
    OfferStatus.TENDER_DRAFT,
    true,
  );
  assert.equal(atDraft.ok, false);

  // Every status without a recall edge, including ones a stale tab might still
  // show as out for signature.
  for (const status of Object.values(OfferStatus)) {
    if (Object.hasOwn(RECALL_EDGES, status)) {
      continue;
    }
    for (const scope of ["offer", "tender", "contract"]) {
      assert.equal(
        resolveRecall(scope, OfferStatus.TENDER_DRAFT, status, true).ok,
        false,
        `${scope} recall accepted at ${status}`,
      );
    }
  }
});

test("a recall refuses a target status that is not the document's draft", () => {
  assert.equal(
    resolveRecall("offer", OfferStatus.TENDER_DRAFT, OfferStatus.TENDER_SENT, true).ok,
    false,
  );
  assert.equal(
    resolveRecall("tender", OfferStatus.AGREED, OfferStatus.TENDER_SENT, true).ok,
    false,
  );
  assert.equal(
    resolveRecall("tender", "PROJECT", OfferStatus.TENDER_SENT, true).ok,
    false,
  );
});

test("a recall refuses a superseded revision", () => {
  assert.equal(
    resolveRecall("tender", OfferStatus.TENDER_DRAFT, OfferStatus.TENDER_SENT, false).ok,
    false,
  );
});

test("a status named after an Object.prototype key finds no recall edge", () => {
  for (const status of ["constructor", "toString", "__proto__"]) {
    assert.equal(
      resolveRecall("tender", OfferStatus.TENDER_DRAFT, status as OfferStatus, true).ok,
      false,
    );
  }
});

test("each document out for signature recalls to its own draft", () => {
  const cases = [
    { from: OfferStatus.OFFER_SENT, scope: "offer", to: OfferStatus.SENT },
    { from: OfferStatus.TENDER_SENT, scope: "tender", to: OfferStatus.TENDER_DRAFT },
    { from: OfferStatus.CONTRACT_SENT, scope: "contract", to: OfferStatus.CONTRACT_DRAFT },
  ] as const;
  for (const { from, scope, to } of cases) {
    assert.deepEqual(resolveRecall(scope, to, from, true), {
      ok: true,
      scope,
      from,
      to,
    });
  }
});

test("an unknown envelope scope throws instead of matching everything", () => {
  assert.throws(() => envelopeScopeFilter("offer-1", "bogus" as never));
  assert.throws(() => envelopeScopeFilter("offer-1", undefined as never));
});

test("every known envelope scope is narrowed to the one offer", () => {
  for (const scope of ["offer", "tender", "contract", "all"] as const) {
    const filter = envelopeScopeFilter("offer-1", scope);
    assert.ok(filter.length > 0, `${scope} has an empty filter`);
    assert.ok(
      JSON.stringify(filter).includes('"offerId":"offer-1"'),
      `${scope} is not scoped to the offer`,
    );
  }
});

test("stepping back from a sent document is classified as a recall", () => {
  assert.deepEqual(
    classifyOfferTransition(OfferStatus.TENDER_SENT, OfferStatus.TENDER_DRAFT),
    { recall: "tender" },
  );
  assert.deepEqual(
    classifyOfferTransition(OfferStatus.CONTRACT_SENT, OfferStatus.CONTRACT_DRAFT),
    { recall: "contract" },
  );
  assert.deepEqual(
    classifyOfferTransition(OfferStatus.OFFER_SENT, OfferStatus.SENT),
    { recall: "offer" },
  );
});

test("sending and the project handoff are not status changes", () => {
  for (const [from, to] of [
    [OfferStatus.CONTRACT_SIGNED, OfferStatus.PROJECT],
    [OfferStatus.TENDER_DRAFT, OfferStatus.TENDER_SENT],
    [OfferStatus.CONTRACT_DRAFT, OfferStatus.CONTRACT_SENT],
  ] as const) {
    assert.equal(classifyOfferTransition(from, to), "send-only", `${from} → ${to}`);
  }
});

test("ordinary moves and self-transitions still classify as before", () => {
  assert.equal(classifyOfferTransition(OfferStatus.PENDING, OfferStatus.SENT), "allowed");
  assert.equal(classifyOfferTransition(OfferStatus.PROJECT, OfferStatus.PROJECT), "self");
  assert.equal(
    classifyOfferTransition(OfferStatus.PENDING, OfferStatus.PROJECT),
    "invalid",
  );
});

test("the generic table holds no recall edge and no edge into a sent or project status", () => {
  const writtenElsewhere = new Set<OfferStatus>([
    OfferStatus.OFFER_SENT,
    OfferStatus.TENDER_SENT,
    OfferStatus.CONTRACT_SENT,
    OfferStatus.PROJECT,
  ]);
  for (const [from, targets] of Object.entries(OFFER_WORKFLOW_TRANSITIONS)) {
    for (const to of targets ?? []) {
      assert.ok(!writtenElsewhere.has(to), `${from} → ${to} is in the generic table`);
      assert.notEqual(
        RECALL_EDGES[from as OfferStatus]?.to,
        to,
        `recall edge ${from} → ${to} is in the generic table`,
      );
    }
  }
});

test("a recall back to SENT skips the owner gate; a first send does not", () => {
  assert.equal(requiresOwnerGate(OfferStatus.OFFER_SENT, OfferStatus.SENT), false);
  assert.equal(requiresOwnerGate(OfferStatus.PENDING, OfferStatus.SENT), true);
  assert.equal(requiresOwnerGate(OfferStatus.SENT, OfferStatus.AGREED), true);
  assert.equal(requiresOwnerGate(OfferStatus.AGREED, OfferStatus.AGREED), false);
});
