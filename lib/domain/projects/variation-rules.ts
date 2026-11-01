import type {
  InvoiceStatus,
  VariationKind,
  VariationStatus,
} from "@prisma/client";

import type { Cents } from "../tradies/billing-rules";

// What a variation is worth, and to whom. Pure, so the wizard's preview, the
// document the client receives, the Xero invoice and the Variations tab all
// read one set of figures rather than four that might disagree.
//
// Every amount here is ex GST unless its name says otherwise, because an
// activity's price is: the milestone budget the handoff set from the offer's
// cost lines is ex GST, and a variation reprices that activity.

/** Australian GST. A Xero invoice raised ex GST adds the same 10%. */
export const GST_RATE = 0.1;

/** "V-001". */
export function formatVariationNumber(number: number | null): string {
  return number === null ? "V-—" : `V-${String(number).padStart(3, "0")}`;
}

/**
 * The activity's price to the client today: what the offer priced it at, plus
 * every chargeable variation already raised on it.
 *
 * A promotional variation does not move it. The client was shown a new price
 * on that document, but was charged nothing for it — so the price they are
 * paying, which is what the next variation is measured from, is unchanged.
 */
export function activityClientPriceCents(input: {
  readonly budgetCents: Cents;
  readonly variations: readonly {
    readonly kind: VariationKind;
    readonly status: VariationStatus;
    readonly costCents: Cents;
  }[];
}): Cents {
  return input.variations
    .filter(countsTowardsClientPrice)
    .reduce(
      (total, variation) => total + variation.costCents,
      input.budgetCents,
    );
}

/** A raised chargeable variation is part of what the client pays. */
export function countsTowardsClientPrice(variation: {
  readonly kind: VariationKind;
  readonly status: VariationStatus;
}): boolean {
  return variation.kind === "CHARGEABLE" && variation.status === "APPROVED";
}

export type VariationCharge = {
  /** New price less previous: the change to the activity, ex GST. */
  readonly differenceCents: Cents;
  /** What the client is billed, ex GST. Zero when promotional. */
  readonly chargeExGstCents: Cents;
  readonly gstCents: Cents;
  /** What the client pays. Zero when promotional. */
  readonly chargeIncGstCents: Cents;
  /** What the builder absorbs, ex GST. Zero when chargeable. */
  readonly absorbedCents: Cents;
};

/** The money a variation moves, given the two prices. */
export function variationCharge(input: {
  readonly kind: VariationKind;
  readonly previousPriceCents: Cents;
  readonly newPriceCents: Cents;
}): VariationCharge {
  const differenceCents = input.newPriceCents - input.previousPriceCents;
  if (input.kind === "PROMOTIONAL") {
    return {
      absorbedCents: differenceCents,
      chargeExGstCents: 0,
      chargeIncGstCents: 0,
      differenceCents,
      gstCents: 0,
    };
  }
  const gstCents = Math.round(differenceCents * GST_RATE);
  return {
    absorbedCents: 0,
    chargeExGstCents: differenceCents,
    chargeIncGstCents: differenceCents + gstCents,
    differenceCents,
    gstCents,
  };
}

export type VariationSummaryRow = {
  readonly kind: VariationKind;
  readonly status: VariationStatus;
  readonly costCents: Cents;
  readonly invoiceStatus: InvoiceStatus | null;
  readonly invoiceTotalCents: Cents | null;
  readonly invoiceAmountPaidCents: Cents | null;
  /** Something did not land: Xero, the document or the email. */
  readonly needsAttention: boolean;
};

export type VariationSummary = {
  readonly count: number;
  readonly chargeable: { readonly count: number; readonly cents: Cents };
  readonly promotional: { readonly count: number; readonly cents: Cents };
  /** Invoiced to the client and not yet paid, inc GST. */
  readonly awaitingPaymentCents: Cents;
  readonly needsAttention: number;
};

/** The KPI cards on the Variations tab. Rejected variations count nowhere. */
export function summarizeVariations(
  rows: readonly VariationSummaryRow[],
): VariationSummary {
  let chargeableCount = 0;
  let chargeableCents = 0;
  let promotionalCount = 0;
  let promotionalCents = 0;
  let awaitingPaymentCents = 0;
  let needsAttention = 0;
  let count = 0;
  for (const row of rows) {
    if (row.needsAttention) needsAttention += 1;
    if (row.status === "REJECTED") continue;
    count += 1;
    if (row.kind === "PROMOTIONAL") {
      promotionalCount += 1;
      promotionalCents += row.costCents;
    } else {
      chargeableCount += 1;
      chargeableCents += row.costCents;
    }
    if (
      row.invoiceTotalCents !== null
      && (row.invoiceStatus === "AUTHORISED"
        || row.invoiceStatus === "SUBMITTED")
    ) {
      awaitingPaymentCents += Math.max(
        0,
        row.invoiceTotalCents - (row.invoiceAmountPaidCents ?? 0),
      );
    }
  }
  return {
    awaitingPaymentCents,
    chargeable: { cents: chargeableCents, count: chargeableCount },
    count,
    needsAttention,
    promotional: { cents: promotionalCents, count: promotionalCount },
  };
}
