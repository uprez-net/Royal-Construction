import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { collectOfferSendBlockers } from "@/lib/offer/offer-readiness";
import { buildWelcomeParagraphs } from "@/lib/offer/workspace-proposal-content";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import { buildTenderHtml } from "@/lib/offer/offer-tender-html";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { INITIAL_OFFER_JOB } from "@/lib/offer/workspace-model";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import { LEGACY_CALC_VERSION } from "@/lib/offer/workspace-persistence";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

function zeroAreaSnapshot(): OfferWorkspaceSnapshot {
  return {
    job: { ...INITIAL_OFFER_JOB },
    lines: INITIAL_COST_LINES,
    allowances: INITIAL_ALLOWANCES,
    exclusions: INITIAL_EXCLUSIONS,
    draft: INITIAL_OFFER_DRAFT,
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: 0,
    extraCosts: INITIAL_EXTRA_COSTS,
    calcVersion: LEGACY_CALC_VERSION,
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
  };
}

test("send readiness blocks when no floor area is entered", () => {
  const blockers = collectOfferSendBlockers({
    hasLead: true,
    hasKnownFloorArea: false,
    needsOverrideReason: false,
    expiryState: "valid",
  });
  assert.ok(
    blockers.some((b) => b.id === "floor-area" && b.severity === "block"),
  );
});

test("a zero-area proposal does not tell the client their home is 0 m²", () => {
  const html = buildProposalHtml(
    buildProposalInput(zeroAreaSnapshot()),
    EMPTY_OFFER_IMAGES,
  );
  assert.doesNotMatch(html, /0 m²/);
  assert.doesNotMatch(html, /0 square metres/);
  assert.ok(
    buildWelcomeParagraphs(INITIAL_OFFER_JOB).every(
      (p) => !p.includes("0 square metres"),
    ),
  );
});

test("a zero-area tender does not contract the client to 0 m²", () => {
  // The signed document, and the one the earlier fix missed: buildTenderHtml
  // computes its own total from the job rather than reading `areaLabel`, so the
  // proposal-side fix could not reach it. The omit-zero rule for the LOT area
  // already sat three lines above this one in the same file.
  const html = buildTenderHtml(buildProposalInput(zeroAreaSnapshot()));
  assert.doesNotMatch(html, /0 m²/);
  assert.ok(
    !html.includes("Total build area"),
    "the row should be omitted, not printed empty",
  );
});

test("a real area still prints on the tender", () => {
  // The guard must not have silently removed the row for everyone.
  const base = zeroAreaSnapshot();
  const snapshot = {
    ...base,
    job: { ...base.job, groundFloorSqm: 180 },
  };
  const html = buildTenderHtml(buildProposalInput(snapshot));
  assert.ok(html.includes("Total build area"), "the row disappeared entirely");
});

test("every send path refuses a zero-area offer, not just the proposal", () => {
  // Four paths reach a client: the proposal email, the Tender, the Contract and
  // the accept-for-signature flow. The first two were guarded; the other two
  // were not, so an offer blocked from emailing could still be sent for
  // signature with the same missing area.
  const paths = [
    ["lib/offer/sends/proposal-email.ts", "the proposal email"],
    ["lib/offer/sends/tender-envelope.ts", "the Tender"],
    ["lib/offer/sends/contract-envelope.ts", "the Contract"],
    ["lib/offer/sends/acceptance-envelope.ts", "accept-for-signature"],
  ];
  for (const [file, label] of paths) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.ok(
      source.includes("getAreaBasisTotalSqm")
        && /totalAreaSqm <= 0/.test(source),
      `${label} (${file}) can still send an offer with no floor area`,
    );
  }
});

test("the Send button is gated by the blockers, not a second copy of the rule", () => {
  // The list and the button had already drifted: the workspace showed "Enter
  // floor areas before sending a proposal" above a Send button that stayed
  // enabled, because the button restated three of the four block-severity rules
  // by hand and floor-area was the fourth.
  const source = readFileSync(
    join(
      process.cwd(),
      "components/offers/new-workflow/new-offer-workspace.tsx",
    ),
    "utf8",
  );
  assert.ok(
    /const canSend = useMemo\(\s*\(\) =>\s*!sendBlockers\.some\(\(blocker\) => blocker\.severity === "block"\)/.test(
      source,
    ),
    "canSend is not derived from sendBlockers",
  );
  assert.ok(
    !/canSend=\{\s*leadId !== undefined/.test(source),
    "the hand-written copy of the send rule is back",
  );
});
