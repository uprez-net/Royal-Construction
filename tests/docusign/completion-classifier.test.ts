import assert from "node:assert/strict";
import { test } from "node:test";

import { EnvelopeStatus, OfferStatus } from "@prisma/client";

import {
  classifyCompletion,
  completedEventNote,
  completedEventNotePrefix,
  executedPdfPathname,
  isArchivedForEnvelope,
  isDeclinableEnvelopeStatus,
  type CompletionFacts,
} from "../../lib/docusign/completion-classifier";

// The Connect webhook archived a completed envelope onto its parent whenever the
// envelope was the latest for the document, before asking whether the offer was
// still waiting on it. A recalled or voided envelope that DocuSign nonetheless
// completed was filed as the executed Tender. Its archive guard also asked only
// whether ANY URL was on file, so a re-sent document kept the first envelope's PDF.
// Recording an unexpected completion then moved the row from VOIDED to COMPLETED,
// so the next delivery of the same event advanced the offer on the recalled
// envelope; and a decline on a voided envelope still moved the offer.

const tenderSent: CompletionFacts = {
  isLatest: true,
  isActive: true,
  offerStatus: OfferStatus.TENDER_SENT,
  expectedFromStatus: OfferStatus.TENDER_SENT,
  envelopeDbStatusBefore: EnvelopeStatus.DELIVERED,
  advancedByThisEnvelope: false,
  flaggedUnexpected: false,
};

// ─── classifyCompletion ───

test("the signature the offer is waiting on advances it", () => {
  assert.equal(classifyCompletion(tenderSent), "advance");
});

test("a retry after the envelope was already marked completed still advances", () => {
  assert.equal(
    classifyCompletion({
      ...tenderSent,
      envelopeDbStatusBefore: EnvelopeStatus.COMPLETED,
    }),
    "advance",
  );
});

test("a redelivery after this envelope moved the offer on is a replay", () => {
  for (const offerStatus of [
    OfferStatus.TENDER_SIGNED,
    OfferStatus.CONTRACT_DRAFT,
  ]) {
    assert.equal(
      classifyCompletion({
        ...tenderSent,
        offerStatus,
        envelopeDbStatusBefore: EnvelopeStatus.COMPLETED,
        advancedByThisEnvelope: true,
      }),
      "legit-replay",
      `${offerStatus} not treated as a replay`,
    );
  }
});

test("a completion on a recalled tender is unexpected", () => {
  // Recall moved the offer back to TENDER_DRAFT; nothing was advanced by it.
  assert.equal(
    classifyCompletion({
      ...tenderSent,
      offerStatus: OfferStatus.TENDER_DRAFT,
    }),
    "unexpected",
  );
});

test("a completion on a superseded revision is unexpected", () => {
  assert.equal(
    classifyCompletion({
      ...tenderSent,
      offerStatus: OfferStatus.SUPERSEDED,
      isActive: false,
    }),
    "unexpected",
  );
  assert.equal(
    classifyCompletion({ ...tenderSent, isActive: false }),
    "unexpected",
  );
});

test("a completion over an envelope we recorded as voided is unexpected", () => {
  // The offer still reads TENDER_SENT (the recall's status move failed after the
  // void), but a voided envelope is not a signature the app asked for.
  assert.equal(
    classifyCompletion({
      ...tenderSent,
      envelopeDbStatusBefore: EnvelopeStatus.VOIDED,
    }),
    "unexpected",
  );
});

test("an envelope with a newer sibling is a stale sibling, unless it was flagged unexpected", () => {
  assert.equal(
    classifyCompletion({ ...tenderSent, isLatest: false }),
    "stale-sibling",
  );
  assert.equal(
    classifyCompletion({
      ...tenderSent,
      isLatest: false,
      advancedByThisEnvelope: true,
    }),
    "stale-sibling",
  );
});

test("the advance note carries the prefix a replay is recognised by", () => {
  assert.ok(
    completedEventNote("env-1").startsWith(completedEventNotePrefix("env-1")),
  );
});

test("every later delivery of an unexpected completion stays unexpected", () => {
  const firstDelivery: CompletionFacts = {
    ...tenderSent,
    envelopeDbStatusBefore: EnvelopeStatus.VOIDED,
  };
  assert.equal(classifyCompletion(firstDelivery), "unexpected");

  // Recording it moved the row to COMPLETED. The offer still reads TENDER_SENT.
  const redelivery: CompletionFacts = {
    ...firstDelivery,
    envelopeDbStatusBefore: EnvelopeStatus.COMPLETED,
    flaggedUnexpected: true,
  };
  assert.equal(classifyCompletion(redelivery), "unexpected");
  // A newer envelope sent since does not drop it, so a copy whose first archive
  // failed is still stored.
  assert.equal(
    classifyCompletion({ ...redelivery, isLatest: false }),
    "unexpected",
  );
});

// ─── isDeclinableEnvelopeStatus ───

test("a decline moves the offer only for an envelope still out, or on a retry", () => {
  for (const status of [
    EnvelopeStatus.CREATED,
    EnvelopeStatus.SENT,
    EnvelopeStatus.DELIVERED,
    // A retry after the first delivery failed part-way.
    EnvelopeStatus.DECLINED,
  ]) {
    assert.equal(isDeclinableEnvelopeStatus(status), true, `${status} refused`);
  }
  // Recall confirmed the void: the customer declined a withdrawn document.
  for (const status of [EnvelopeStatus.VOIDED, EnvelopeStatus.COMPLETED]) {
    assert.equal(
      isDeclinableEnvelopeStatus(status),
      false,
      `${status} let through`,
    );
  }
});

// ─── isArchivedForEnvelope ───

const blob = (pathname: string) =>
  `https://store.public.blob.vercel-storage.com/${pathname}`;

test("a parent URL filed from this envelope counts as archived", () => {
  assert.equal(
    isArchivedForEnvelope(
      blob("offer-signed/tender-env-2.pdf"),
      "tender",
      "env-2",
    ),
    true,
  );
});

test("a parent URL from another envelope or document does not", () => {
  const url = blob("offer-signed/tender-env-1.pdf");
  assert.equal(isArchivedForEnvelope(url, "tender", "env-2"), false);
  assert.equal(isArchivedForEnvelope(url, "contract", "env-1"), false);
});

test("no URL is not archived", () => {
  assert.equal(isArchivedForEnvelope(null, "tender", "env-1"), false);
  assert.equal(isArchivedForEnvelope("", "tender", "env-1"), false);
  assert.equal(isArchivedForEnvelope("not a url", "tender", "env-1"), false);
});

test("a URL with a query string still matches", () => {
  assert.equal(
    isArchivedForEnvelope(
      `${blob("offer-signed/offer-env-3.pdf")}?download=1`,
      "offer",
      "env-3",
    ),
    true,
  );
});

test("the archive guard recognises the pathname the archive writes", () => {
  assert.equal(
    isArchivedForEnvelope(
      blob(executedPdfPathname("contract", "env-4")),
      "contract",
      "env-4",
    ),
    true,
  );
  assert.equal(
    executedPdfPathname("tender", "env-5", { unexpected: true }),
    "offer-signed/unexpected/tender-env-5.pdf",
  );
});
