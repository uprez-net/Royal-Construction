import assert from "node:assert/strict";
import { test } from "node:test";

import { EnvelopeDocType, OfferStatus } from "@prisma/client";

import {
  decideRecallPullBack,
  describeUnconfirmedVoid,
  envelopeScopeFilter,
  resolveRecall,
  unconfirmedSendDocTypesForScope,
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
  for (const scope of [
    "all",
    "bogus",
    undefined,
    {},
    "toString",
    "offer",
    "contract",
  ]) {
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
    resolveRecall(
      "offer",
      OfferStatus.TENDER_DRAFT,
      OfferStatus.TENDER_SENT,
      true,
    ).ok,
    false,
  );
  assert.equal(
    resolveRecall("tender", OfferStatus.AGREED, OfferStatus.TENDER_SENT, true)
      .ok,
    false,
  );
  assert.equal(
    resolveRecall("tender", "PROJECT", OfferStatus.TENDER_SENT, true).ok,
    false,
  );
});

test("a recall refuses a superseded revision", () => {
  assert.equal(
    resolveRecall(
      "tender",
      OfferStatus.TENDER_DRAFT,
      OfferStatus.TENDER_SENT,
      false,
    ).ok,
    false,
  );
});

test("a status named after an Object.prototype key finds no recall edge", () => {
  for (const status of ["constructor", "toString", "__proto__"]) {
    assert.equal(
      resolveRecall(
        "tender",
        OfferStatus.TENDER_DRAFT,
        status as OfferStatus,
        true,
      ).ok,
      false,
    );
  }
});

test("each document out for signature recalls to its own draft", () => {
  const cases = [
    { from: OfferStatus.OFFER_SENT, scope: "offer", to: OfferStatus.SENT },
    {
      from: OfferStatus.TENDER_SENT,
      scope: "tender",
      to: OfferStatus.TENDER_DRAFT,
    },
    {
      from: OfferStatus.CONTRACT_SENT,
      scope: "contract",
      to: OfferStatus.CONTRACT_DRAFT,
    },
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

// ── #321: which UnconfirmedEnvelopeSend rows a scope covers ──
//
// A parallel mapping to envelopeScopeFilter, because UnconfirmedEnvelopeSend
// cannot be scoped the same way — it hangs off Offer directly, not off
// Tender/Contract, precisely because those rows don't exist yet when a send's
// outcome is unknown. If this mapping ever drifts from envelopeScopeFilter's
// (a scope missing a doc type, or including one it shouldn't), a recall on
// that scope would silently stop seeing an unresolved send for it.

test("an unknown scope throws here too, for the same reason", () => {
  assert.throws(() => unconfirmedSendDocTypesForScope("bogus" as never));
});

test("a single-document scope maps to exactly that document's type", () => {
  assert.deepEqual(unconfirmedSendDocTypesForScope("offer"), [
    EnvelopeDocType.OFFER,
  ]);
  assert.deepEqual(unconfirmedSendDocTypesForScope("tender"), [
    EnvelopeDocType.TENDER,
  ]);
  assert.deepEqual(unconfirmedSendDocTypesForScope("contract"), [
    EnvelopeDocType.CONTRACT,
  ]);
});

test("'all' covers every document type envelopeScopeFilter covers", () => {
  const docTypes = unconfirmedSendDocTypesForScope("all");
  for (const type of [
    EnvelopeDocType.TENDER,
    EnvelopeDocType.CONTRACT,
    EnvelopeDocType.OFFER,
  ]) {
    assert.ok(
      docTypes.includes(type),
      `"all" is missing ${type} — a revision would fail to see an unresolved send for it`,
    );
  }
});

test("stepping back from a sent document is classified as a recall", () => {
  assert.deepEqual(
    classifyOfferTransition(OfferStatus.TENDER_SENT, OfferStatus.TENDER_DRAFT),
    { recall: "tender" },
  );
  assert.deepEqual(
    classifyOfferTransition(
      OfferStatus.CONTRACT_SENT,
      OfferStatus.CONTRACT_DRAFT,
    ),
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
    assert.equal(
      classifyOfferTransition(from, to),
      "send-only",
      `${from} → ${to}`,
    );
  }
});

test("ordinary moves and self-transitions still classify as before", () => {
  assert.equal(
    classifyOfferTransition(OfferStatus.PENDING, OfferStatus.SENT),
    "allowed",
  );
  assert.equal(
    classifyOfferTransition(OfferStatus.PROJECT, OfferStatus.PROJECT),
    "self",
  );
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
      assert.ok(
        !writtenElsewhere.has(to),
        `${from} → ${to} is in the generic table`,
      );
      assert.notEqual(
        RECALL_EDGES[from as OfferStatus]?.to,
        to,
        `recall edge ${from} → ${to} is in the generic table`,
      );
    }
  }
});

test("a recall back to SENT skips the owner gate; a first send does not", () => {
  assert.equal(
    requiresOwnerGate(OfferStatus.OFFER_SENT, OfferStatus.SENT),
    false,
  );
  assert.equal(requiresOwnerGate(OfferStatus.PENDING, OfferStatus.SENT), true);
  assert.equal(requiresOwnerGate(OfferStatus.SENT, OfferStatus.AGREED), true);
  assert.equal(
    requiresOwnerGate(OfferStatus.AGREED, OfferStatus.AGREED),
    false,
  );
});

// Recall and Create revision treated a void DocuSign did not confirm as a
// warning and moved on anyway: the offer went back to draft (or forked a new
// revision) while the customer could still sign the old document. They now stop
// unless every live envelope was confirmed voided.

test("a pull-back proceeds when every live envelope was voided", () => {
  assert.equal(
    decideRecallPullBack({
      liveIds: ["env-1", "env-2"],
      voidedIds: ["env-1", "env-2"],
      endedIds: [],
      unsettled: [],
    }).proceed,
    true,
  );
});

test("a pull-back proceeds when nothing was live", () => {
  assert.equal(
    decideRecallPullBack({
      liveIds: [],
      voidedIds: [],
      endedIds: [],
      unsettled: [],
    }).proceed,
    true,
  );
});

test("a pull-back stops when any envelope is unsettled, whatever the reason", () => {
  for (const reason of ["still-out", "signed", "unrecorded"] as const) {
    assert.equal(
      decideRecallPullBack({
        liveIds: ["env-1", "env-2"],
        voidedIds: ["env-1"],
        endedIds: [],
        unsettled: [{ id: "env-2", docusignId: "ds-2", reason }],
      }).proceed,
      false,
      `a ${reason} envelope let the pull-back through`,
    );
  }
});

test("a pull-back stops when a live envelope is unaccounted for", () => {
  // Neither voided, ended nor reported unsettled: not confirmed, so not safe.
  assert.equal(
    decideRecallPullBack({
      liveIds: ["env-1"],
      voidedIds: [],
      endedIds: [],
      unsettled: [],
    }).proceed,
    false,
  );
});

// An envelope DocuSign had already voided or declined, whose Connect event never
// arrived, used to block recall and revision for good: DocuSign refuses to void
// it again, so it could never be confirmed.
test("a pull-back proceeds when DocuSign had already ended an envelope", () => {
  assert.equal(
    decideRecallPullBack({
      liveIds: ["env-1", "env-2"],
      voidedIds: ["env-1"],
      endedIds: ["env-2"],
      unsettled: [],
    }).proceed,
    true,
  );
});

test("the refusal says the document is still signable and to check DocuSign first", () => {
  const message = describeUnconfirmedVoid({
    unsettled: [{ id: "env-1", docusignId: "ds-123", reason: "still-out" }],
    voidedCount: 0,
    action: "recall",
  });
  assert.match(message, /still out for signature/);
  assert.match(message, /ds-123/);
  assert.match(message, /status was not changed/);
  assert.match(
    message,
    /open the envelope in DocuSign, void it there if it is still out for signature, then recall again/,
  );
  assert.doesNotMatch(message, /admin/);
});

test("the refusal for a signed envelope does not advise voiding or retrying", () => {
  // DocuSign cannot void a signed envelope, so that advice leads nowhere.
  const message = describeUnconfirmedVoid({
    unsettled: [{ id: "env-1", docusignId: "ds-9", reason: "signed" }],
    voidedCount: 0,
    action: "revision",
  });
  assert.match(message, /ds-9 as signed/);
  assert.match(message, /No revision was created/);
  assert.match(message, /Tell an admin/);
  assert.doesNotMatch(
    message,
    /void it|void any|Try again|still out for signature/,
  );
});

test("the refusal for a void the app could not record does not say it is still signable", () => {
  const message = describeUnconfirmedVoid({
    unsettled: [{ id: "env-1", docusignId: "ds-4", reason: "unrecorded" }],
    voidedCount: 0,
    action: "recall",
  });
  assert.match(message, /ds-4/);
  assert.match(message, /could not record/);
  assert.match(message, /Try again in a moment/);
  assert.doesNotMatch(
    message,
    /still out for signature|void it|did not confirm/,
  );
});

test("the refusal does not hide envelopes that were already voided", () => {
  const message = describeUnconfirmedVoid({
    unsettled: [{ id: "env-2", docusignId: "ds-2", reason: "still-out" }],
    voidedCount: 1,
    action: "revision",
  });
  assert.match(message, /No revision was created/);
  assert.match(message, /One other envelope was voided and stays voided/);
  assert.match(message, /then create the revision again/);
  assert.doesNotMatch(message, /[Nn]othing was changed/);
});

test("the refusal names every envelope still out", () => {
  const message = describeUnconfirmedVoid({
    unsettled: [
      { id: "env-1", docusignId: "ds-1", reason: "still-out" },
      { id: "env-2", docusignId: "ds-2", reason: "still-out" },
    ],
    voidedCount: 0,
    action: "recall",
  });
  assert.match(message, /envelopes ds-1, ds-2/);
  assert.match(message, /void any still out for signature, then recall again/);
});

// ── A send whose outcome DocuSign never confirmed ──
//
// #289: the create call times out, DocuSign may or may not have issued and
// emailed an envelope, and reconciliation cannot find one. The offer stays at
// *_SENT with no usable envelope id. If a recall then treats that as "nothing
// is out for signature", the offer returns to draft, the estimator resends, and
// the client can end up holding two live documents — with a signature on the
// orphan reaching nobody.

test("an unconfirmed send blocks a pull-back instead of vanishing", () => {
  const decision = decideRecallPullBack({
    liveIds: ["env-1"],
    voidedIds: [],
    endedIds: [],
    unsettled: [{ id: "env-1", docusignId: null, reason: "unconfirmed-send" }],
  });
  assert.equal(
    decision.proceed,
    false,
    "the offer would have gone back to draft with a possible live envelope out",
  );
});

test("the estimator is told to check DocuSign, without being given an id that does not exist", () => {
  const message = describeUnconfirmedVoid({
    unsettled: [{ id: "env-1", docusignId: null, reason: "unconfirmed-send" }],
    voidedCount: 0,
    action: "recall",
  });

  assert.match(message, /timed out/);
  assert.match(message, /Open DocuSign/);
  assert.match(
    message,
    /two/,
    "the duplicate risk is the point of the warning",
  );
  assert.ok(
    !message.includes("null") && !message.includes("undefined"),
    "a missing envelope id leaked into the operator's message",
  );
});

test("a mixed outcome names the envelopes it can and still refuses", () => {
  const message = describeUnconfirmedVoid({
    unsettled: [
      { id: "env-1", docusignId: null, reason: "unconfirmed-send" },
      { id: "env-2", docusignId: "ds-2", reason: "still-out" },
    ],
    voidedCount: 1,
    action: "recall",
  });

  assert.match(message, /Open DocuSign/);
  assert.match(
    message,
    /ds-2/,
    "the identifiable envelope should still be named",
  );
  assert.match(message, /status was not changed/);
});

test("a definitively failed send is still cleaned up, not escalated", () => {
  // The pre-existing case: the row exists but the call never reached DocuSign,
  // so there is genuinely nothing signable. That must keep proceeding, or every
  // failed send would need a trip to DocuSign to clear.
  const decision = decideRecallPullBack({
    liveIds: ["env-1"],
    voidedIds: ["env-1"],
    endedIds: [],
    unsettled: [],
  });
  assert.equal(decision.proceed, true);
});
