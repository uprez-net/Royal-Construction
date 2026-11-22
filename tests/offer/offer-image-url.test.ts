import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ROYAL_BLOB_HOST,
  allowedOfferImageHosts,
  isAllowedOfferImageUrl,
} from "@/lib/offer/offer-image-url";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  LEGACY_CALC_VERSION,
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { INITIAL_EXTRA_COSTS } from "@/lib/offer/extra-costs";

// The customer PDF renderers fetch every offer image URL from inside our
// network, and the URL arrives in a client-supplied snapshot. Any URL used to be
// accepted, so a hand-built save could point the renderer at an internal address.

const BLOB_URL =
  "https://udafiztdzg1cn8u2.public.blob.vercel-storage.com/offer-ai/hero.png";

test("accepts an image in Royal's Blob storage", () => {
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
    // Another Vercel Blob tenant: same domain, someone else's storage.
    "https://attacker.public.blob.vercel-storage.com/x.png",
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

test("follows the stores in the Blob tokens, public or private, and always allows Royal's", () => {
  assert.equal(BLOB_URL.startsWith(`https://${ROYAL_BLOB_HOST}/`), true);
  // process.env is typed here with the app's keys required, so go through a
  // view that admits one can be absent — the case this test is about.
  const env = process.env as Record<string, string | undefined>;
  const before = {
    main: env.BLOB_READ_WRITE_TOKEN,
    recordings: env.BLOB_PRIVATE_READ_WRITE_TOKEN,
  };
  try {
    // A token names the store that writes the images; the hosts follow it, so
    // replacing the store (#571) doesn't leave the allowlist on the old one.
    env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_Rep1acement_secret";
    delete env.BLOB_PRIVATE_READ_WRITE_TOKEN;
    assert.deepEqual(
      [...allowedOfferImageHosts()].sort(),
      [
        ROYAL_BLOB_HOST,
        "rep1acement.private.blob.vercel-storage.com",
        "rep1acement.public.blob.vercel-storage.com",
      ].sort(),
    );
    for (const url of [
      "https://rep1acement.public.blob.vercel-storage.com/a.png",
      "https://rep1acement.private.blob.vercel-storage.com/a.png",
      // Royal's original store: an offer saved before the move still names it.
      BLOB_URL,
    ]) {
      assert.equal(isAllowedOfferImageUrl(url), true, url);
    }
    // With the tokens in hand, a stranger's private store is still a stranger's.
    assert.equal(
      isAllowedOfferImageUrl(
        "https://attacker.private.blob.vercel-storage.com/a.png",
      ),
      false,
    );

    // No token (build, tests, the browser) or an unreadable one: Royal's host,
    // and any private host — dropping those would empty a slot on autosave,
    // and the server re-checks every save with the tokens.
    for (const token of [undefined, "not-a-blob-token"]) {
      if (token === undefined) delete env.BLOB_READ_WRITE_TOKEN;
      else env.BLOB_READ_WRITE_TOKEN = token;
      assert.equal(isAllowedOfferImageUrl(BLOB_URL), true);
      assert.equal(
        isAllowedOfferImageUrl(
          "https://rep1acement.private.blob.vercel-storage.com/a.png",
        ),
        true,
      );
      assert.equal(
        isAllowedOfferImageUrl(
          "https://attacker.public.blob.vercel-storage.com/x.png",
        ),
        false,
      );
    }
  } finally {
    for (const [key, value] of [
      ["BLOB_READ_WRITE_TOKEN", before.main],
      ["BLOB_PRIVATE_READ_WRITE_TOKEN", before.recordings],
    ] as const) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
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
  extraCosts: INITIAL_EXTRA_COSTS,
  calcVersion: LEGACY_CALC_VERSION,
};

test("a stored snapshot with a bad image URL opens with that slot empty", () => {
  const persisted = serializeWorkspace({
    ...SNAPSHOT,
    images: {
      hero: { url: BLOB_URL, source: "upload" },
      kitchen: {
        url: "http://169.254.169.254/latest/meta-data/",
        source: "upload",
      },
    },
  }) as Record<string, unknown>;
  // Pre-{url,source} rows stored a bare string per slot; those are screened too.
  (persisted.images as Record<string, unknown>).living =
    "https://example.com/x.png";

  const restored = deserializeWorkspace(
    parseWorkspaceState(JSON.parse(JSON.stringify(persisted))),
  );

  assert.deepEqual(restored.images, {
    hero: { url: BLOB_URL, source: "upload" },
  });
});
