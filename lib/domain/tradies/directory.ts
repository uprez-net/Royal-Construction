import {
  Prisma,
  TradieApprovalActionType,
  type Tradie,
  type TradiePriceUnit,
} from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainValidationError } from "../errors";
import {
  attributionUserId,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { assertCanReadTradieDirectory } from "../access/tradies";
import { resolveTradeLabel } from "./trade-types";
import { requireActiveTradie as requireTradie } from "./lifecycle";

// The tradie directory: who may read it, who may change it, and what has to go
// through an approval instead of being written directly.
//
// Every one of these existed twice, and the app's copy authorized nobody.
// lib/data/tradie-management.ts is a "use server" module, so each of its
// exports is a POST endpoint any signed-in caller can invoke with arguments of
// their choosing — and the Redux slice calls several of them straight from the
// browser, so the directive cannot simply be dropped the way it was for
// lib/data/user.ts. The guard has to move INTO the rule, which is here.
//
// tests/security/use-server-auth.test.ts already carried all of these on its
// allowlist, with "tradie domain, outside this pass (follow-up)" and
// "(follow-up: staff only)" against them. This is that follow-up.
//
// The rules are Eve's, because Eve had rules: ADMIN to add, change or price a
// tradie; staff to read the directory, rate one or report an incident. Two or
// three people share a login here and all of them are ADMIN, so in practice
// this refuses a CUSTOMER account and nobody else — which is exactly the
// account that should never have been able to POST `createTradie`.

export type TradieInput = {
  readonly name: string;
  readonly trade: string;
  readonly abn: string;
  readonly phone: string;
  readonly email: string;
  readonly additionalEmails?: readonly string[];
  readonly location?: string | null;
  readonly note?: string | null;
  readonly lastQuotedPrice?: number | null;
  readonly lastQuotedPriceUnit: TradiePriceUnit;
};

/** Add a tradie to the directory. ADMIN only. */
export async function createTradie(
  principal: DomainPrincipal,
  input: TradieInput,
  db: DomainDb,
): Promise<Tradie> {
  requireAdminPrincipal(principal);
  const trade = await resolveTradeLabel(input.trade, db);

  return db.tradie.create({
    data: {
      abn: input.abn,
      additionalEmails: [...(input.additionalEmails ?? [])],
      email: input.email,
      lastQuotedPrice: input.lastQuotedPrice ?? null,
      lastQuotedPriceUnit: input.lastQuotedPriceUnit,
      location: input.location ?? null,
      name: input.name,
      note: input.note ?? null,
      phone: input.phone,
      trade,
    },
  });
}

/**
 * Change a tradie's details. ADMIN only.
 *
 * Deliberately excludes the price: a rate change is a request an admin
 * approves, not a field edit — see `requestTradiePriceChange`.
 */
export async function updateTradie(
  principal: DomainPrincipal,
  tradieId: string,
  input: Partial<
    Omit<TradieInput, "lastQuotedPrice" | "lastQuotedPriceUnit">
  > & { isFavourite?: boolean },
  db: DomainDb,
): Promise<Tradie> {
  requireAdminPrincipal(principal);
  const current = await requireTradie(tradieId, db);
  const trade =
    input.trade === undefined
      ? undefined
      : await resolveTradeLabel(input.trade, db, { current: current.trade });

  const data = Object.fromEntries(
    Object.entries({
      abn: input.abn,
      additionalEmails: input.additionalEmails
        ? [...input.additionalEmails]
        : undefined,
      email: input.email,
      // Also settable here, as well as through toggleTradieFavourite, because
      // an admin editing a tradie can flip the pin in the same save. The
      // dedicated toggle stays staff-level for the directory's star control.
      isFavourite: input.isFavourite,
      location: input.location,
      name: input.name,
      note: input.note,
      phone: input.phone,
      trade,
    }).filter(([, value]) => value !== undefined),
  );

  return db.tradie.update({ data, where: { id: tradieId } });
}

/** Pin or unpin a tradie in the directory. Staff. */
export async function toggleTradieFavourite(
  principal: DomainPrincipal,
  tradieId: string,
  isFavourite: boolean,
  db: DomainDb,
): Promise<Tradie> {
  assertCanReadTradieDirectory(principal);
  await requireTradie(tradieId, db);

  return db.tradie.update({
    data: { isFavourite },
    where: { id: tradieId },
  });
}

export type ApprovalRequest = {
  readonly approvalId: string;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly tradieTrade: string;
  readonly tradieEmail: string;
  readonly tradiePhone: string;
};

/**
 * Ask for a tradie's rate to change.
 *
 * Never a direct write. The amount that eventually lands is read back off this
 * approval row when an admin says yes, so the requested figure is the one
 * applied — an approver cannot substitute a different number at the point of
 * approving. That property only holds because the request is stored rather
 * than passed through.
 */
export async function requestTradiePriceChange(
  principal: DomainPrincipal,
  input: {
    tradieId: string;
    amount: number;
    /**
     * Optional, because the app's price form has always been able to omit it.
     * The resolver only applies a unit it recognises, so an absent one leaves
     * the tradie's existing basis alone rather than defaulting to one.
     */
    unit?: TradiePriceUnit;
    reason: string;
  },
  db: DomainDb,
): Promise<ApprovalRequest & { previousPrice: number | null }> {
  requireAdminPrincipal(principal);
  const tradie = await requireTradie(input.tradieId, db);

  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new DomainValidationError(
      "A price change needs a non-negative amount.",
      "amount",
    );
  }

  const approval = await db.tradieApproval.create({
    data: {
      actionType: TradieApprovalActionType.PRICE_CHANGE,
      reason: input.reason,
      requestedBy: requireActorId(principal),
      tradieId: tradie.id,
      updationData: {
        newHourlyRate: input.amount,
        ...(input.unit === undefined ? {} : { newPriceUnit: input.unit }),
      },
    },
    select: { id: true },
  });

  return {
    approvalId: approval.id,
    previousPrice:
      tradie.lastQuotedPrice === null
        ? null
        : Number(tradie.lastQuotedPrice.toString()),
    tradieEmail: tradie.email,
    tradieId: tradie.id,
    tradieName: tradie.name,
    tradiePhone: tradie.phone,
    tradieTrade: tradie.trade,
  };
}

/**
 * Ask for a tradie to be removed.
 *
 * The row stays in the directory until an admin approves it, so a booking
 * already made against this tradie is never orphaned by the request itself.
 */
export async function requestTradieRemoval(
  principal: DomainPrincipal,
  input: { tradieId: string; reason: string },
  db: DomainDb,
): Promise<ApprovalRequest> {
  requireAdminPrincipal(principal);
  const tradie = await requireTradie(input.tradieId, db);

  const approval = await db.tradieApproval.create({
    data: {
      actionType: TradieApprovalActionType.TRADIE_REMOVAL,
      reason: input.reason,
      requestedBy: requireActorId(principal),
      tradieId: tradie.id,
    },
    select: { id: true },
  });

  return {
    approvalId: approval.id,
    tradieEmail: tradie.email,
    tradieId: tradie.id,
    tradieName: tradie.name,
    tradiePhone: tradie.phone,
    tradieTrade: tradie.trade,
  };
}

/**
 * Record a rating and refresh the tradie's average. Staff.
 *
 * The average is recomputed from the ratings table rather than folded into a
 * running figure, so a deleted or corrected rating cannot leave the stored
 * average permanently wrong.
 */
export async function rateTradie(
  principal: DomainPrincipal,
  input: { tradieId: string; rating: number; comment?: string | null },
  db: DomainDb,
): Promise<{
  average: number | null;
  tradieId: string;
  tradieName: string;
  tradieTrade: string;
}> {
  assertCanReadTradieDirectory(principal);
  const tradie = await requireTradie(input.tradieId, db);

  if (!Number.isFinite(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new DomainValidationError(
      "A rating must be between 1 and 5.",
      "rating",
    );
  }

  const userId = requireActorId(principal);

  await db.tradieRating.create({
    data: {
      comment: input.comment?.trim() || null,
      rating: input.rating,
      tradieId: tradie.id,
      userId,
    },
  });

  const aggregate = await db.tradieRating.aggregate({
    _avg: { rating: true },
    where: { tradieId: tradie.id },
  });
  const average =
    aggregate._avg.rating === null ? null : Number(aggregate._avg.rating);

  await db.tradie.update({
    data: { rating: average === null ? null : new Prisma.Decimal(average) },
    where: { id: tradie.id },
  });

  return {
    average,
    tradieId: tradie.id,
    tradieName: tradie.name,
    tradieTrade: tradie.trade,
  };
}

/**
 * The user id to stamp on a request or a rating.
 *
 * An approval request and a rating both name who made them, so unlike a
 * history line neither can be written by a cron or an open route — there
 * would be nobody to attribute it to.
 */
function requireActorId(principal: DomainPrincipal): string {
  const userId = attributionUserId(principal);
  if (userId === null) {
    throw new DomainValidationError("This action needs a signed-in user.");
  }
  return userId;
}
