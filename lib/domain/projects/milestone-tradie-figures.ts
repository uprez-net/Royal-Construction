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

// An activity's "Tradie quoted" (B) and "Total invoiced" (C), typed by hand on
// the Financials tab in place of what its own bookings and their invoices add
// up to. Stored ex GST on `Milestone.tradieQuotedOverride` and
// `tradieInvoicedOverride`; null puts the derived figure back. The report
// (`financial-report.ts`) decides what a typed figure replaces.

export type TradieFigure = "quoted" | "invoiced";

/** `Decimal(12, 2)`: the largest amount the column holds, in cents. */
const MAX_CENTS = 999_999_999_999;

const COLUMN = {
  invoiced: "tradieInvoicedOverride",
  quoted: "tradieQuotedOverride",
} as const satisfies Record<TradieFigure, string>;

const LABEL: Record<TradieFigure, string> = {
  invoiced: "total invoiced",
  quoted: "tradie quoted",
};

const MONEY = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  minimumFractionDigits: 2,
  style: "currency",
});

const describe = (cents: Cents | null) =>
  cents === null ? "the bookings' figure" : MONEY.format(cents / 100);

const decimal = (cents: Cents) => new Prisma.Decimal(cents).dividedBy(100);

export type SetMilestoneTradieFigureInput = {
  readonly milestoneId: string;
  readonly figure: TradieFigure;
  /** The activity's own figure, ex GST, in whole cents; null clears it. */
  readonly cents: Cents | null;
  /** The override the operator was looking at when they edited it. */
  readonly previousCents: Cents | null;
};

export type SetMilestoneTradieFigureOutcome = {
  readonly projectId: string;
  readonly milestoneId: string;
  /** False when the figure already stood there: a replayed save. */
  readonly changed: boolean;
};

/**
 * Type an activity's tradie quoted or total invoiced figure by hand, or clear
 * it back to what its bookings say.
 *
 * Admin only, like the Financials tab it is edited from. The figure is the
 * activity's own; its sub-activities keep adding theirs on top, so the tab
 * subtracts them before it calls this.
 *
 * Saving the same figure twice — a double-click, a retry after a timeout — is
 * answered as unchanged. A figure that moved since the operator opened it is
 * refused, so an edit made from a stale screen cannot overwrite one they never
 * saw. The write is conditional on the value just read, for the same reason
 * two tabs saving at once cannot both apply.
 */
export async function setMilestoneTradieFigure(
  principal: DomainPrincipal,
  input: SetMilestoneTradieFigureInput,
  db: DomainDb,
): Promise<SetMilestoneTradieFigureOutcome> {
  requireAdminPrincipal(principal);
  const {
    project: { id: projectId },
  } = await authorizeMilestone(principal, input.milestoneId, db);

  const { cents, figure } = input;
  if (cents !== null) {
    if (!Number.isInteger(cents) || cents < 0) {
      throw new DomainValidationError(
        "Enter an amount of $0.00 or more, to the cent.",
        "amount",
      );
    }
    if (cents > MAX_CENTS) {
      throw new DomainValidationError("That amount is too large.", "amount");
    }
  }

  const column = COLUMN[figure];
  const milestone = await db.milestone.findUniqueOrThrow({
    select: {
      id: true,
      name: true,
      tradieInvoicedOverride: true,
      tradieQuotedOverride: true,
    },
    where: { id: input.milestoneId },
  });
  const stored = milestone[column];
  const currentCents = stored === null ? null : toCents(stored);

  const unchanged: SetMilestoneTradieFigureOutcome = {
    changed: false,
    milestoneId: milestone.id,
    projectId,
  };
  if (currentCents === cents) return unchanged;
  if (currentCents !== input.previousCents) {
    throw new DomainStaleVersionError(
      `${milestone.name}'s ${LABEL[figure]} is now ${describe(currentCents)}, not the ${describe(input.previousCents)} you were editing. Check the new figure and try again.`,
    );
  }

  const value = cents === null ? null : decimal(cents);
  const update: Prisma.MilestoneUpdateManyArgs =
    figure === "quoted"
      ? {
          data: { tradieQuotedOverride: value },
          where: { id: milestone.id, tradieQuotedOverride: stored },
        }
      : {
          data: { tradieInvoicedOverride: value },
          where: { id: milestone.id, tradieInvoicedOverride: stored },
        };
  const { count } = await db.milestone.updateMany(update);
  if (count !== 1) {
    const now = await db.milestone.findUniqueOrThrow({
      select: { tradieInvoicedOverride: true, tradieQuotedOverride: true },
      where: { id: milestone.id },
    });
    const nowValue = now[column];
    const nowCents = nowValue === null ? null : toCents(nowValue);
    if (nowCents === cents) return unchanged;
    throw new DomainStaleVersionError(
      `${milestone.name}'s ${LABEL[figure]} was changed to ${describe(nowCents)} while you were editing it. Check the new figure and try again.`,
    );
  }

  await logActionOrThrow(
    {
      ...createActivityLogEntry("milestoneTradieFigureChanged", {
        figure: LABEL[figure],
        milestoneId: milestone.id,
        milestoneName: milestone.name,
        next: describe(cents),
        previous: describe(currentCents),
        projectId,
      }),
      authorId: attributionUserId(principal),
    },
    db,
  );

  return { changed: true, milestoneId: milestone.id, projectId };
}
