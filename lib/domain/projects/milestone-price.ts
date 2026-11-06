import { Prisma } from "@prisma/client";

import { createActivityLogEntry } from "@/types/activityLog";

import { authorizeMilestone } from "../access/projects";
import { logActionOrThrow } from "../audit/action-log";
import type { DomainDb } from "../db";
import { DomainStaleVersionError, DomainValidationError } from "../errors";
import {
  attributionUserId,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { toCents, type Cents } from "../tradies/billing-rules";

// An activity's quoted price: the share of its stage's contract price the
// Financials tab sets it against. Stored as `Milestone.budget`, ex GST, and
// for a parent it already includes its sub-activities — the handoff rolled
// each child's budget into its parent's (`createMilestonesFromTemplate`), and
// the report reads a parent's own share as what is left after its children.

/** `Decimal(12, 2)`: the largest amount the column holds, in cents. */
const MAX_PRICE_CENTS = 999_999_999_999;

const MONEY = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  minimumFractionDigits: 2,
  style: "currency",
});

const money = (cents: Cents) => MONEY.format(cents / 100);
const decimal = (cents: Cents) => new Prisma.Decimal(cents).dividedBy(100);

export type SetMilestonePriceInput = {
  readonly milestoneId: string;
  /** The new price, ex GST, in whole cents. */
  readonly priceCents: Cents;
  /** The price the operator was looking at when they edited it. */
  readonly previousPriceCents: Cents;
};

export type SetMilestonePriceOutcome = {
  readonly projectId: string;
  readonly milestoneId: string;
  /** False when the price already stood at this figure — a replayed save. */
  readonly changed: boolean;
  /** Parents whose price moved with it, nearest first. */
  readonly ancestorIds: readonly string[];
};

/**
 * Set an activity's quoted price.
 *
 * Admin only, like the Financials tab it is edited from: the price sits beside
 * what each tradie is paid, which is the margin.
 *
 * Its parents move by the same amount, so each keeps its own share and a
 * parent's price still includes its children. A parent cannot be priced below
 * what its sub-activities already add up to: its own share would be negative,
 * which the report would clamp to zero and so show a total the operator did
 * not enter.
 *
 * The stage price does not move. It is pegged to the contract's claim for the
 * stage, and the report shows what the activities leave unallocated instead.
 *
 * Saving the same figure twice — a double-click, a retry after a timeout — is
 * answered as unchanged rather than applied again. A price that moved since
 * the operator opened it is refused, so an edit made from a stale screen
 * cannot overwrite one they never saw.
 *
 * Must run inside the caller's transaction: the activity, its parents and the
 * history row are one change.
 */
export async function setMilestonePrice(
  principal: DomainPrincipal,
  input: SetMilestonePriceInput,
  db: DomainDb,
): Promise<SetMilestonePriceOutcome> {
  requireAdminPrincipal(principal);
  const {
    project: { id: projectId },
  } = await authorizeMilestone(principal, input.milestoneId, db);

  const { priceCents } = input;
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new DomainValidationError(
      "Enter a price of $0.00 or more, to the cent.",
      "price",
    );
  }
  if (priceCents > MAX_PRICE_CENTS) {
    throw new DomainValidationError("That price is too large.", "price");
  }

  const milestone = await db.milestone.findUniqueOrThrow({
    select: {
      budget: true,
      childrenMilestones: { select: { budget: true } },
      id: true,
      name: true,
      parentId: true,
    },
    where: { id: input.milestoneId },
  });

  const unchanged: SetMilestonePriceOutcome = {
    ancestorIds: [],
    changed: false,
    milestoneId: milestone.id,
    projectId,
  };
  const currentCents = toCents(milestone.budget);
  if (currentCents === priceCents) return unchanged;
  if (currentCents !== input.previousPriceCents) {
    throw new DomainStaleVersionError(
      `${milestone.name} is now priced at ${money(currentCents)}, not the ${money(input.previousPriceCents)} you were editing. Check the new figure and try again.`,
    );
  }

  const childrenCents = milestone.childrenMilestones.reduce(
    (total, child) => total + toCents(child.budget),
    0,
  );
  if (priceCents < childrenCents) {
    throw new DomainValidationError(
      `${milestone.name} cannot be priced below its sub-activities, which add up to ${money(childrenCents)}.`,
      "price",
    );
  }

  // Conditional on the figure just read, so two saves racing from one screen
  // cannot both move the parents. The loser re-reads: if the winner already
  // saved this same price, that is the replay answered above.
  const { count } = await db.milestone.updateMany({
    data: { budget: decimal(priceCents) },
    where: { budget: milestone.budget, id: milestone.id },
  });
  if (count !== 1) {
    const now = await db.milestone.findUniqueOrThrow({
      select: { budget: true },
      where: { id: milestone.id },
    });
    if (toCents(now.budget) === priceCents) return unchanged;
    throw new DomainStaleVersionError(
      `${milestone.name} was repriced to ${money(toCents(now.budget))} while you were editing it. Check the new figure and try again.`,
    );
  }

  const deltaCents = priceCents - currentCents;
  const ancestorIds: string[] = [];
  let parentId = milestone.parentId;
  while (parentId) {
    const parent = await db.milestone.update({
      data: { budget: { increment: decimal(deltaCents) } },
      select: { id: true, parentId: true },
      where: { id: parentId },
    });
    ancestorIds.push(parent.id);
    parentId = parent.parentId;
  }

  await logActionOrThrow(
    {
      ...createActivityLogEntry("milestonePriceChanged", {
        milestoneId: milestone.id,
        milestoneName: milestone.name,
        previousPrice: money(currentCents),
        price: money(priceCents),
        projectId,
      }),
      authorId: attributionUserId(principal),
    },
    db,
  );

  return {
    ancestorIds,
    changed: true,
    milestoneId: milestone.id,
    projectId,
  };
}
