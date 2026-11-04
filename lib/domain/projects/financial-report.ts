import {
  InvoiceStatus,
  MilestoneStatus,
  ProjectStage,
  TradieInvoiceSource,
  TradieScheduleStatus,
  type VariationKind,
  type VariationStatus,
} from "@prisma/client";

import {
  buildMilestoneTree,
  groupRootsByStage,
  type WithChildren,
} from "@/lib/projects/milestone-tree";
import { resolveStageClaims } from "@/lib/projects/stage-claim";
import type { ProjectPaymentStage } from "@/types/project-flow";

import {
  bookingBillingState,
  isCommittedBooking,
  isCountedInvoice,
  type BookingBillingState,
  type BookingPrice,
  type Cents,
  type PriceBasis,
} from "../tradies/billing-rules";
import { countsTowardsClientPrice, GST_RATE } from "./variation-rules";

// A project's profit and loss, activity by activity. Pure: the query in
// `financials.ts` loads the rows and this decides every figure, so the rule is
// testable without a database and the screen does no arithmetic of its own.
//
// Three amounts per activity, as issue #405 names them:
//
//   A  tender    — what the activity is priced at to the client: the
//                  milestone's budget, which the handoff set from the offer's
//                  cost lines, plus every chargeable variation raised on it
//                  since. Ex GST. A promotional variation does not move it:
//                  the client pays nothing more, and the extra cost the
//                  builder absorbs is already in B and C, so counting it
//                  again here would take it off the profit twice.
//   B  quoted    — what the tradies booked on it agreed to do it for: the sum
//                  of its committed bookings' prices, ex GST.
//   C  invoiced  — what those tradies have actually billed: the sum of the
//                  invoices against its bookings, ex GST.
//
// A stage's A is not the sum of its activities. It is pegged to the stage's
// share of the contract — the same claim the Milestones tab shows and the
// stage invoice bills (`resolveStageClaims`), brought to ex GST — plus the
// chargeable variations raised inside it. The activities divide that price
// between them, and `allocatedCents` says how much of it they account for, so
// an activity priced up or down shows as an unallocated or over-allocated
// stage rather than quietly moving the price the client agreed to.
//
// Profit/loss is A − C, as the issue specifies. Before anything is invoiced
// that is just A, which reads as the whole tender being profit; so an activity
// with nothing invoiced says "Not invoiced" rather than a green number, and
// the forecast — A less what each booking will cost, the larger of its price
// and its invoices — is carried alongside for the activities still in flight.

export type FinancialOutcome = "PROFIT" | "LOSS" | "EVEN" | "NOT_INVOICED";

export type FinancialFigures = {
  readonly tenderCents: Cents;
  readonly quotedCents: Cents;
  readonly invoicedCents: Cents;
  /** What the work will cost: per booking, the larger of B and C. */
  readonly forecastCostCents: Cents;
  /** A − C, or null while nothing is invoiced. */
  readonly profitCents: Cents | null;
  /** (A − C) / A × 100, or null when there is no tender to divide by. */
  readonly profitPercent: number | null;
  /** A − forecast cost. */
  readonly forecastProfitCents: Cents;
  readonly forecastPercent: number | null;
  readonly outcome: FinancialOutcome;
  /** Invoiced exceeds quoted (C > B), on the activity or on one booking. */
  readonly overInvoiced: boolean;
  /** A committed booking has no price, so B is short by an unknown amount. */
  readonly quoteMissing: boolean;
  /** A quote did not state its GST basis and was read as ex GST. */
  readonly gstAssumed: boolean;
};

export type FinancialInvoice = {
  readonly id: string;
  readonly scheduleId: string | null;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly source: TradieInvoiceSource;
  readonly status: InvoiceStatus;
  readonly counted: boolean;
  readonly invoiceNumber: string | null;
  readonly reference: string | null;
  /** ISO dates. */
  readonly issuedDate: string;
  readonly dueDate: string | null;
  readonly subTotalCents: Cents;
  readonly totalTaxCents: Cents;
  readonly totalCents: Cents;
  readonly amountPaidCents: Cents;
  readonly notes: string | null;
  /** The tradie's own invoice document, when one was uploaded with it. */
  readonly documentUrl: string | null;
  readonly documentName: string | null;
};

export type FinancialBooking = {
  readonly id: string;
  readonly milestoneId: string | null;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly trade: string | null;
  readonly status: TradieScheduleStatus;
  readonly scheduledDate: string;
  readonly committed: boolean;
  /** B for this booking: its price when committed, else 0. */
  readonly agreedCents: Cents;
  readonly priceBasis: PriceBasis;
  readonly gstStated: boolean;
  readonly invoicedCents: Cents;
  readonly billing: BookingBillingState;
  readonly invoices: readonly FinancialInvoice[];
};

export type FinancialActivity = {
  readonly id: string;
  readonly name: string;
  /**
   * The activity's own quoted price, ex variations: the stored milestone
   * budget, which already includes its sub-activities. The figure the inline
   * editor starts from and `setMilestonePrice` writes.
   */
  readonly priceCents: Cents;
  readonly order: number;
  readonly stage: ProjectStage;
  readonly status: MilestoneStatus;
  /** Chargeable variations raised on this activity itself, ex GST. In A. */
  readonly variationCents: Cents;
  /** This activity alone: its own tender share and its own bookings. */
  readonly own: FinancialFigures;
  /** With every activity beneath it. Equal to `own` for a leaf. */
  readonly figures: FinancialFigures;
  readonly bookings: readonly FinancialBooking[];
  readonly children: readonly FinancialActivity[];
};

/** A stage's price, as the contract's claim schedule fixes it. */
export type StagePrice = {
  /** Percentage points of the contract (15 for 15%), as the Milestones tab shows. */
  readonly percentage: number | null;
  /** The claim as the contract states it: inc GST when `gstIncluded`. */
  readonly claimCents: Cents;
  readonly gstIncluded: boolean;
  /** The claim ex GST — the stage's A before variations. */
  readonly exGstCents: Cents;
};

export type FinancialStage = {
  readonly stage: ProjectStage;
  readonly figures: FinancialFigures;
  readonly activities: readonly FinancialActivity[];
  /**
   * The contract price `figures.tenderCents` is pegged to, or null when the
   * contract says nothing for this stage — then A is the activities' sum.
   */
  readonly price: StagePrice | null;
  /** What the activities' own prices add up to, ex variations. */
  readonly allocatedCents: Cents;
  /** Chargeable variations raised on the stage's activities. In A. */
  readonly variationCents: Cents;
};

export type FinancialTotals = FinancialFigures & {
  /** Invoices known to be on this project but not yet put against a booking. */
  readonly unallocatedCents: Cents;
  /** Variations billed to the client, ex GST. Already inside A. */
  readonly chargeableVariationCents: Cents;
  /** Variations the builder absorbed, ex GST. Shown, not subtracted again. */
  readonly promotionalVariationCents: Cents;
};

export type ProjectFinancialReport = {
  readonly stages: readonly FinancialStage[];
  /** Committed or invoiced bookings that sit on no activity. */
  readonly unassigned: {
    readonly figures: FinancialFigures;
    readonly bookings: readonly FinancialBooking[];
  };
  readonly unallocatedInvoices: readonly FinancialInvoice[];
  readonly totals: FinancialTotals;
};

export type ReportMilestone = {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly parentId: string | null;
  readonly projectStage: ProjectStage;
  readonly status: MilestoneStatus;
  readonly budgetCents: Cents;
};

/** A raised variation, as the report counts it. */
export type ReportVariation = {
  readonly milestoneId: string | null;
  readonly kind: VariationKind;
  readonly status: VariationStatus;
  readonly costCents: Cents;
};

export type ReportBooking = {
  readonly id: string;
  readonly milestoneId: string | null;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly trade: string | null;
  readonly status: TradieScheduleStatus;
  readonly scheduledDate: string;
  readonly price: BookingPrice;
};

export type ReportInvoice = Omit<FinancialInvoice, "counted">;

/**
 * Each stage's contract price, from the project's claim schedule.
 *
 * Resolved through `resolveStageClaims`, the one rule the Milestones tab and
 * the stage invoice already share, so the Financials tab cannot price a stage
 * differently from what the client is billed for it. The claim is converted to
 * ex GST when the contract sum includes GST — the same `gstIncluded` reading
 * the stage invoice uses for its line amounts — because every other figure in
 * the report is ex GST. A stage with no knowable claim is left out, and its
 * price falls back to the sum of its activities.
 */
export function resolveStagePrices(input: {
  readonly paymentStages: readonly ProjectPaymentStage[] | null | undefined;
  readonly totalBudget: number;
  readonly gstIncluded: boolean | null | undefined;
}): Partial<Record<ProjectStage, StagePrice>> {
  const claims = resolveStageClaims(input.paymentStages, input.totalBudget);
  const gstIncluded = Boolean(input.gstIncluded);
  const prices: Partial<Record<ProjectStage, StagePrice>> = {};
  for (const stage of Object.values(ProjectStage)) {
    const { claim, percentage } = claims[stage];
    if (claim === null || !Number.isFinite(claim) || claim <= 0) continue;
    const claimCents = Math.round(claim * 100);
    prices[stage] = {
      claimCents,
      exGstCents: gstIncluded
        ? Math.round(claimCents / (1 + GST_RATE))
        : claimCents,
      gstIncluded,
      percentage,
    };
  }
  return prices;
}

/** The sums a set of figures is derived from. */
type Sums = {
  tender: Cents;
  quoted: Cents;
  invoiced: Cents;
  forecastCost: Cents;
  bookingOver: boolean;
  quoteMissing: boolean;
  gstAssumed: boolean;
};

const ZERO: Sums = {
  bookingOver: false,
  forecastCost: 0,
  gstAssumed: false,
  invoiced: 0,
  quoteMissing: false,
  quoted: 0,
  tender: 0,
};

function add(a: Sums, b: Sums): Sums {
  return {
    bookingOver: a.bookingOver || b.bookingOver,
    forecastCost: a.forecastCost + b.forecastCost,
    gstAssumed: a.gstAssumed || b.gstAssumed,
    invoiced: a.invoiced + b.invoiced,
    quoteMissing: a.quoteMissing || b.quoteMissing,
    quoted: a.quoted + b.quoted,
    tender: a.tender + b.tender,
  };
}

function percentOf(part: Cents, whole: Cents): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export function financialOutcome(input: {
  readonly tenderCents: Cents;
  readonly invoicedCents: Cents;
}): FinancialOutcome {
  if (input.invoicedCents <= 0) return "NOT_INVOICED";
  const profit = input.tenderCents - input.invoicedCents;
  return profit > 0 ? "PROFIT" : profit < 0 ? "LOSS" : "EVEN";
}

function figuresOf(sums: Sums): FinancialFigures {
  const outcome = financialOutcome({
    invoicedCents: sums.invoiced,
    tenderCents: sums.tender,
  });
  const profit =
    outcome === "NOT_INVOICED" ? null : sums.tender - sums.invoiced;
  const forecastProfit = sums.tender - sums.forecastCost;
  return {
    forecastCostCents: sums.forecastCost,
    forecastPercent: percentOf(forecastProfit, sums.tender),
    forecastProfitCents: forecastProfit,
    gstAssumed: sums.gstAssumed,
    invoicedCents: sums.invoiced,
    outcome,
    // B is short by an unknown amount when a price is missing, so C > B on the
    // activity says nothing; a single booking billed past its own price still
    // does.
    overInvoiced:
      sums.bookingOver
      || (!sums.quoteMissing && sums.quoted > 0 && sums.invoiced > sums.quoted),
    profitCents: profit,
    profitPercent: profit === null ? null : percentOf(profit, sums.tender),
    quoteMissing: sums.quoteMissing,
    quotedCents: sums.quoted,
    tenderCents: sums.tender,
  };
}

function bookingSums(booking: FinancialBooking): Sums {
  return {
    bookingOver: booking.billing === "OVER_INVOICED",
    forecastCost: Math.max(booking.agreedCents, booking.invoicedCents),
    gstAssumed: booking.committed && !booking.gstStated,
    invoiced: booking.invoicedCents,
    quoteMissing: booking.committed && booking.priceBasis === "NONE",
    quoted: booking.agreedCents,
    tender: 0,
  };
}

/** Build the report from a project's rows. */
export function buildProjectFinancialReport(input: {
  readonly milestones: readonly ReportMilestone[];
  readonly bookings: readonly ReportBooking[];
  readonly invoices: readonly ReportInvoice[];
  readonly variations?: readonly ReportVariation[];
  /** From `resolveStagePrices`. A stage absent here is priced by its activities. */
  readonly stagePrices?: Partial<Record<ProjectStage, StagePrice>>;
}): ProjectFinancialReport {
  // Variations are counted on the activity they reprice. One logged before
  // variations named an activity has no tender to join, so it is left out
  // rather than guessed onto one.
  const variationsByMilestone = new Map<string, Cents>();
  let chargeableVariationCents = 0;
  let promotionalVariationCents = 0;
  for (const variation of input.variations ?? []) {
    if (!variation.milestoneId || variation.status !== "APPROVED") continue;
    if (countsTowardsClientPrice(variation)) {
      chargeableVariationCents += variation.costCents;
      variationsByMilestone.set(
        variation.milestoneId,
        (variationsByMilestone.get(variation.milestoneId) ?? 0)
          + variation.costCents,
      );
    } else {
      promotionalVariationCents += variation.costCents;
    }
  }

  const invoicesBySchedule = new Map<string, FinancialInvoice[]>();
  const unallocatedInvoices: FinancialInvoice[] = [];
  const scheduleIds = new Set(input.bookings.map((booking) => booking.id));
  for (const invoice of input.invoices) {
    const row: FinancialInvoice = {
      ...invoice,
      counted: isCountedInvoice(invoice.status),
    };
    if (invoice.scheduleId && scheduleIds.has(invoice.scheduleId)) {
      const list = invoicesBySchedule.get(invoice.scheduleId) ?? [];
      list.push(row);
      invoicesBySchedule.set(invoice.scheduleId, list);
    } else {
      unallocatedInvoices.push(row);
    }
  }

  // A booking is shown when it is money: committed, or billed. A quote that
  // was never chosen, or a booking declined before it was invoiced, is not.
  const bookingsByMilestone = new Map<string, FinancialBooking[]>();
  const unassignedBookings: FinancialBooking[] = [];
  const milestoneIds = new Set(input.milestones.map((m) => m.id));
  for (const booking of input.bookings) {
    const invoices = invoicesBySchedule.get(booking.id) ?? [];
    const committed = isCommittedBooking(booking.status);
    if (!committed && invoices.length === 0) continue;
    const agreedCents = committed ? booking.price.exGstCents : 0;
    const invoicedCents = invoices
      .filter((invoice) => invoice.counted)
      .reduce((total, invoice) => total + invoice.subTotalCents, 0);
    const row: FinancialBooking = {
      agreedCents,
      billing: bookingBillingState({ agreedCents, invoicedCents }),
      committed,
      gstStated: booking.price.gstStated,
      id: booking.id,
      invoicedCents,
      invoices: [...invoices].sort((a, b) =>
        a.issuedDate.localeCompare(b.issuedDate),
      ),
      milestoneId: booking.milestoneId,
      priceBasis: booking.price.basis,
      scheduledDate: booking.scheduledDate,
      status: booking.status,
      trade: booking.trade,
      tradieId: booking.tradieId,
      tradieName: booking.tradieName,
    };
    if (booking.milestoneId && milestoneIds.has(booking.milestoneId)) {
      const list = bookingsByMilestone.get(booking.milestoneId) ?? [];
      list.push(row);
      bookingsByMilestone.set(booking.milestoneId, list);
    } else {
      unassignedBookings.push(row);
    }
  }

  const sumBookings = (bookings: readonly FinancialBooking[]) =>
    bookings.map(bookingSums).reduce(add, ZERO);

  // Profit to date, gathered activity by activity on each one's OWN figures:
  // a parent with one invoiced child must not bring its uninvoiced children's
  // tender along, or work nobody has billed yet reads as profit.
  let profitTender = 0;
  let profitInvoiced = 0;

  const toActivity = (
    node: WithChildren<ReportMilestone>,
  ): { activity: FinancialActivity; sums: Sums; variationCents: Cents } => {
    const children = node.childrenMilestones.map(toActivity);
    const bookings = [...(bookingsByMilestone.get(node.id) ?? [])].sort(
      (a, b) => a.scheduledDate.localeCompare(b.scheduledDate),
    );
    // The handoff rolled every child's budget into its parent's, so a parent's
    // own share of the tender is what is left after its children. A child
    // added later is not in the parent's figure; clamping at zero keeps that
    // from going negative and leaves the child's own budget to count.
    const childTender = node.childrenMilestones.reduce(
      (total, child) => total + child.budgetCents,
      0,
    );
    const variationCents = variationsByMilestone.get(node.id) ?? 0;
    const ownSums: Sums = {
      ...sumBookings(bookings),
      tender: Math.max(0, node.budgetCents - childTender) + variationCents,
    };
    const sums = children.map((child) => child.sums).reduce(add, ownSums);
    const subtreeVariationCents = children.reduce(
      (total, child) => total + child.variationCents,
      variationCents,
    );
    if (ownSums.invoiced > 0) {
      profitTender += ownSums.tender;
      profitInvoiced += ownSums.invoiced;
    }
    return {
      activity: {
        bookings,
        children: children.map((child) => child.activity),
        figures: figuresOf(sums),
        id: node.id,
        name: node.name,
        order: node.order,
        own: figuresOf(ownSums),
        priceCents: sums.tender - subtreeVariationCents,
        stage: node.projectStage,
        status: node.status,
        variationCents,
      },
      sums,
      variationCents: subtreeVariationCents,
    };
  };

  // Grouped on roots, as the Milestones tab and the claim generator group
  // them: a child tagged with another stage stays under its parent's.
  const byStage = groupRootsByStage(buildMilestoneTree(input.milestones));
  let stageTotals = ZERO;
  const stages: FinancialStage[] = [];
  for (const stage of Object.values(ProjectStage)) {
    const roots = byStage[stage];
    if (!roots?.length) continue;
    const built = roots.map(toActivity);
    const activitySums = built.map((root) => root.sums).reduce(add, ZERO);
    const stageVariationCents = built.reduce(
      (total, root) => total + root.variationCents,
      0,
    );
    const price = input.stagePrices?.[stage] ?? null;
    const sums: Sums = price
      ? { ...activitySums, tender: price.exGstCents + stageVariationCents }
      : activitySums;
    stageTotals = add(stageTotals, sums);
    stages.push({
      activities: built.map((root) => root.activity),
      allocatedCents: activitySums.tender - stageVariationCents,
      figures: figuresOf(sums),
      price,
      stage,
      variationCents: stageVariationCents,
    });
  }

  const unassignedSums = sumBookings(unassignedBookings);
  const unallocatedCents = unallocatedInvoices
    .filter((invoice) => invoice.counted)
    .reduce((total, invoice) => total + invoice.subTotalCents, 0);
  const totalSums = add(add(stageTotals, unassignedSums), {
    ...ZERO,
    forecastCost: unallocatedCents,
    invoiced: unallocatedCents,
  });

  // Profit to date counts only the activities that have been invoiced — the
  // tender of work nobody has billed yet is not profit — plus every cost that
  // has no tender against it at all.
  profitInvoiced += unassignedSums.invoiced + unallocatedCents;
  const overall = figuresOf(totalSums);
  const profitToDate =
    profitInvoiced > 0 ? profitTender - profitInvoiced : null;

  return {
    stages,
    totals: {
      ...overall,
      outcome:
        profitToDate === null
          ? "NOT_INVOICED"
          : profitToDate > 0
            ? "PROFIT"
            : profitToDate < 0
              ? "LOSS"
              : "EVEN",
      profitCents: profitToDate,
      chargeableVariationCents,
      profitPercent:
        profitToDate === null ? null : percentOf(profitToDate, profitTender),
      promotionalVariationCents,
      unallocatedCents,
    },
    unallocatedInvoices: [...unallocatedInvoices].sort((a, b) =>
      a.issuedDate.localeCompare(b.issuedDate),
    ),
    unassigned: {
      bookings: unassignedBookings,
      figures: figuresOf(unassignedSums),
    },
  };
}
