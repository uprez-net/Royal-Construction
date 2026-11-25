import assert from "node:assert/strict";
import { describe, test } from "vitest";

import type { DomainDb } from "@/lib/domain/db";
import { stalePriceTextRefusal } from "@/lib/domain/offers/stale-price-text";
import {
  dollarFigures,
  findStalePriceText,
} from "@/lib/offer/stale-price-text";
import type { OfferWorkspaceSnapshot } from "@/lib/offer/workspace-persistence";

// #589: an early-November revision showed one total on the headline and
// another on the allowances page. The text is free text that a revision copies
// as it is, so only a figure that equals an EARLIER total can be called stale.

const snapshot = (over: {
  headline?: string;
  allowanceDescription?: string;
  variationRule?: string;
}): OfferWorkspaceSnapshot =>
  ({
    allowances: [
      {
        description: over.allowanceDescription ?? "Supply and fit",
        label: "Kitchen",
        variationRule: over.variationRule ?? "",
      },
    ],
    draft: {
      headline: over.headline ?? "Your fixed price building proposal",
      inclusionHighlights: ["Slab and frame"],
      introText: "",
      termsSummary: "",
    },
    priceAdjustmentLabel: "",
  }) as unknown as OfferWorkspaceSnapshot;

describe("dollarFigures", () => {
  test("reads whole dollars, thousands separators, cents and a space", () => {
    assert.deepEqual(
      dollarFigures(
        "From $1,234,567.89 or $350, not 12,000 or 5 dollars; $ 90",
      ),
      [1234567.89, 350, 90],
    );
  });
});

describe("findStalePriceText", () => {
  const earlier = [612_500, 561_926.2];
  const now = [640_000, 587_155.96];

  test("a figure equal to an earlier total, and not the current one, is flagged by field", () => {
    const findings = findStalePriceText(
      snapshot({ allowanceDescription: "Balance of the $612,500 contract" }),
      earlier,
      now,
    );
    assert.deepEqual(findings, [
      { field: 'Allowance "Kitchen" description', figure: 612_500 },
    ]);
  });

  test("a total printed to the dollar still matches the cents behind it", () => {
    const findings = findStalePriceText(
      snapshot({ headline: "Fixed price $561,926" }),
      earlier,
      now,
    );
    assert.equal(findings[0]?.field, "Headline");
  });

  test("ordinary allowance amounts do not trigger", () => {
    assert.deepEqual(
      findStalePriceText(
        snapshot({ allowanceDescription: "Allowance of $8,500 for tiles" }),
        earlier,
        now,
      ),
      [],
    );
  });

  test("a price that has not moved is not stale", () => {
    assert.deepEqual(
      findStalePriceText(
        snapshot({ headline: "Fixed price $640,000" }),
        [640_000],
        [640_000],
      ),
      [],
    );
  });

  test("a small earlier total is ignored as a coincidence", () => {
    assert.deepEqual(
      findStalePriceText(
        snapshot({ variationRule: "Up to $5,000" }),
        [5_000],
        [640_000],
      ),
      [],
    );
  });
});

describe("stalePriceTextRefusal", () => {
  const dbWith = (current: object, others: object[]) =>
    ({
      offer: {
        findMany: async () => others,
        findUnique: async () => current,
      },
    }) as unknown as DomainDb;
  const current = {
    baseReference: "RC-Q-1",
    contractValueIncGst: 640_000,
    leadId: 1,
    workspaceState: null,
  };

  test("an offer whose text quotes the earlier revision's total is refused, naming the field", async () => {
    const refusal = await stalePriceTextRefusal(
      dbWith(current, [
        {
          amount: 556_818.18,
          contractValueIncGst: 612_500,
          totalAmount: 612_500,
        },
      ]),
      "offer_2",
      snapshot({ allowanceDescription: "Balance of the $612,500 contract" }),
    );
    assert.match(refusal ?? "", /Allowance "Kitchen" description/);
    assert.match(refusal ?? "", /\$612,500/);
  });

  test("a first revision, with nothing earlier, is never refused", async () => {
    assert.equal(
      await stalePriceTextRefusal(
        dbWith(current, []),
        "offer_1",
        snapshot({ headline: "Fixed price $612,500" }),
      ),
      null,
    );
  });

  test("a clean revision passes", async () => {
    assert.equal(
      await stalePriceTextRefusal(
        dbWith(current, [
          {
            amount: 556_818.18,
            contractValueIncGst: 612_500,
            totalAmount: 612_500,
          },
        ]),
        "offer_2",
        snapshot({ headline: "Fixed price $640,000" }),
      ),
      null,
    );
  });
});
