import assert from "node:assert/strict";
import { test } from "node:test";

import { buildProposalHtml } from "../../lib/offer/offer-proposal-html";
import { buildProposalInput } from "../../lib/offer/offer-proposal-input";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
  createIndividualOwner,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferOwner,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import { INITIAL_TENDER_GATE, type OfferWorkspaceSnapshot } from "../../lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "../../lib/offer/workspace-images";
import { activeOfferPhase, isOfferPhaseUnlocked } from "../../lib/offer/workflow";
import {
  findSignerStatus,
  type OfferSignerStatus,
} from "../../lib/offer/signing-status";

// ─── fixtures ───

function owner(index: number, name: string): OfferOwner {
  const base = createIndividualOwner(`owner-${index}`);
  return {
    ...base,
    displayName: name,
    currentLocation: `${index} Test Street, Sydney NSW 2000`,
    signatories: [
      {
        ...base.signatories[0],
        name,
        email: `owner${index}@example.com`,
        phone: "0400 000 000",
      },
    ],
  };
}

function snapshot(owners: OfferOwner[]): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB, owners },
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: INITIAL_OFFER_DRAFT,
    areaCalculator: INITIAL_AREA_CALCULATOR,
    workspacePricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    rateCardProduct: "DOUBLE_STOREY",
    rateCardTier: "MID",
    overrideReason: "",
    selectedPriceInput: "",
    standardPriceInput: "",
    priceAdjustmentLabel: "",
    images: EMPTY_OFFER_IMAGES,
    tenderGate: INITIAL_TENDER_GATE
  };
}

const signHtml = (owners: OfferOwner[]) =>
  buildProposalHtml(buildProposalInput(snapshot(owners)), EMPTY_OFFER_IMAGES, {
    forSignature: true,
  });
const emailHtml = (owners: OfferOwner[]) =>
  buildProposalHtml(buildProposalInput(snapshot(owners)), EMPTY_OFFER_IMAGES);

// ─── for-signature mode: DocuSign anchors ───

test("for-signature mode emits a sig+date anchor per customer signer", () => {
  const html = signHtml([owner(1, "Alice Owner"), owner(2, "Bob Owner")]);
  assert.match(html, /\\sigOwner1\\/, "missing owner 1 signature anchor");
  assert.match(html, /\\dateOwner1\\/, "missing owner 1 date anchor");
  assert.match(html, /\\sigOwner2\\/, "missing owner 2 signature anchor");
  assert.match(html, /\\dateOwner2\\/, "missing owner 2 date anchor");
});

test("the acceptance is customer-only — no builder anchor, a 'Prepared by' credit", () => {
  const html = signHtml([owner(1, "Alice Owner")]);
  assert.doesNotMatch(
    html,
    /\\sigBuilder\\/,
    "builder must not sign the acceptance",
  );
  assert.match(html, /Prepared by/, "expected a non-signature builder credit");
});

test("signature sections list client acceptance before the builder credit", () => {
  // Scope to the signature <h3>s — "Prepared by" also appears in every page footer.
  const signed = signHtml([owner(1, "Alice Owner")]);
  const clientPos = signed.indexOf("<h3>Client acceptance</h3>");
  const builderPos = signed.indexOf("<h3>Prepared by</h3>");
  assert.ok(clientPos >= 0, "missing client acceptance block");
  assert.ok(builderPos >= 0, "missing Prepared by credit");
  assert.ok(
    clientPos < builderPos,
    "client acceptance must appear above the builder credit",
  );

  const emailed = emailHtml([owner(1, "Alice Owner")]);
  const emailClient = emailed.indexOf("<h3>Client acceptance</h3>");
  const emailBuilder = emailed.indexOf(
    "<h3>For Royal Constructions Pty Ltd</h3>",
  );
  assert.ok(emailClient >= 0, "missing client acceptance on email copy");
  assert.ok(emailBuilder >= 0, "missing builder block on email copy");
  assert.ok(
    emailClient < emailBuilder,
    "client acceptance must appear above the builder on the email copy",
  );
});

test("the emailed copy carries NO DocuSign anchors (wet-sign rules stay)", () => {
  const html = emailHtml([owner(1, "Alice Owner")]);
  assert.doesNotMatch(html, /\\sigOwner1\\/, "email copy must not carry anchors");
  assert.match(html, /Signature: _+/, "email copy should keep the wet-sign rule");
});

test("esc strips backslashes so an owner name can't smuggle an extra anchor", () => {
  // A single signer, but the name embeds a fake anchor token. esc() must strip
  // the backslashes, leaving exactly ONE real \sigOwner1\ (the emitted anchor) —
  // otherwise the name would AutoPlace a second signature tab.
  const html = signHtml([owner(1, "Mallory \\sigOwner1\\ Smith")]);
  const anchors = html.match(/\\sigOwner1\\/g) ?? [];
  assert.equal(
    anchors.length,
    1,
    `expected exactly one owner-1 anchor, found ${anchors.length} (anchor smuggling)`,
  );
});

// ─── workflow phase mapping ───

test("acceptance-signing states stay in the Offer phase", () => {
  assert.equal(activeOfferPhase("offer_sent"), "offer");
  assert.equal(activeOfferPhase("offer_signed"), "offer");
  assert.equal(activeOfferPhase("offer_declined"), "offer");
});

test("a signed (accepted) offer does NOT unlock the Tender phase", () => {
  // Signing the offer is acceptance, not agreement — the estimator still marks
  // agreed to open the Tender phase.
  assert.equal(isOfferPhaseUnlocked("offer_signed", "tender"), false);
  assert.equal(isOfferPhaseUnlocked("offer_sent", "offer"), true);
});

// ─── OFFER signer-status key ───

test("findSignerStatus resolves an OFFER row and never a same-email TENDER row", () => {
  const row = (docType: OfferSignerStatus["docType"]): OfferSignerStatus => ({
    docType,
    role: "CUSTOMER",
    name: "Alice",
    email: "alice@example.com",
    status: "SIGNED",
    signedAt: "2026-07-28T00:00:00.000Z",
    routingOrder: 1,
  });
  const statuses = [row("TENDER"), row("OFFER")];
  const found = findSignerStatus(statuses, "OFFER", "alice@example.com");
  assert.equal(found?.docType, "OFFER");
});
