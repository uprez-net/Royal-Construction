import assert from "node:assert/strict";
import { test } from "node:test";

import { isAllowedOfferImageUrl } from "../../lib/offer/offer-image-url";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
} from "../../lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "../../lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "../../lib/offer/workspace-persistence";

// The customer PDF renderers fetch every offer image URL from inside our
// network, and the URL arrives in a client-supplied snapshot. Any URL used to be
// accepted, so a hand-built save could point the renderer at an internal address.

const BLOB_URL =
  "https://udafiztdzg1cn8u2.public.blob.vercel-storage.com/offer-ai/hero.png";

test("accepts an image in Royal's public Blob storage", () => {
  assert.equal(isAllowedOfferImageUrl(BLOB_URL), true);
});

test("rejects anything outside Blob storage", () => {
  for (const url of [
    BLOB_URL.replace("https:", "http:"),
    "http://169.254.169.254/latest/meta-data/",
    "https://169.254.169.254/latest/meta-data/",
    "https://example.com/hero.png",
    // The suffix must be the host's, not part of a path or a lookalike host.
    "https://evil.example/x.public.blob.vercel-storage.com/hero.png",
    "https://public.blob.vercel-storage.com.evil.example/hero.png",
    "https://user:pass@udafiztdzg1cn8u2.public.blob.vercel-storage.com/a.png",
    "javascript:alert(1)",
    "/images/hero.png",
    "",
  ]) {
    assert.equal(isAllowedOfferImageUrl(url), false, url);
  }
  assert.equal(isAllowedOfferImageUrl(undefined), false);
  assert.equal(isAllowedOfferImageUrl(42), false);
});

const SNAPSHOT: OfferWorkspaceSnapshot = {
  job: INITIAL_OFFER_JOB,
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
  images: {},
  tenderGate: INITIAL_TENDER_GATE,
  adminContentVersion: 0,
  calcVersion: LEGACY_CALC_VERSION,
};

test("a stored snapshot with a bad image URL opens with that slot empty", () => {
  const persisted = serializeWorkspace({
    ...SNAPSHOT,
    images: {
      hero: { url: BLOB_URL, source: "upload" },
      kitchen: { url: "http://169.254.169.254/latest/meta-data/", source: "upload" },
    },
  }) as Record<string, unknown>;
  // Pre-{url,source} rows stored a bare string per slot; those are screened too.
  (persisted.images as Record<string, unknown>).living = "https://example.com/x.png";

  const restored = deserializeWorkspace(
    parseWorkspaceState(JSON.parse(JSON.stringify(persisted))),
  );

  assert.deepEqual(restored.images, {
    hero: { url: BLOB_URL, source: "upload" },
  });
});
