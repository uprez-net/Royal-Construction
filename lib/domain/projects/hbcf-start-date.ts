import { format, parseISO } from "date-fns";

import type { DomainDb } from "../db";
import { DomainValidationError } from "../errors";
import { hbcfClaimDate } from "../insurance/hbcf-claims";

import { STARTED_MILESTONE_STATUSES } from "./milestone-schedule";

// Issue #421: the project's start date follows its HBCF claim date.
//
// The claim date is `legalAdministration.insuranceClaimStartDate` -- the field
// the Overview labels "Insurance Claim Start Date", which is the only claim
// date the project records. One per project, set by a person: a document's own
// date is never applied here (see `hbcfClaimDateConflicts`).
//
// It is the start date **until work starts**. From the first activity starting,
// the start date is the day work actually began (`updateMilestone` writes it,
// `updateProject` locks it), and a later correction to the claim date is saved
// without moving it. That is the existing lock, kept rather than weakened: a
// paperwork correction must not re-date a schedule already under way.

/** Just the part of a requirements payload the claim date is read from. */
type ClaimDateSource =
  | {
      readonly legalAdministration?: {
        readonly insuranceClaimStartDate?: string | null;
      } | null;
    }
  | null
  | undefined;

/**
 * The claim date as the instant the project stores a start date at: UTC
 * midnight of that calendar day, the same instant `new Date("yyyy-MM-dd")`
 * gives the Overview's own start date field. No time zone is involved, so the
 * day on the certificate is the day on the project.
 */
export function startDateFromHbcfClaim(
  requirements: ClaimDateSource,
): Date | null {
  const claim = hbcfClaimDate(requirements?.legalAdministration ?? null);
  return claim ? new Date(`${claim}T00:00:00.000Z`) : null;
}

export type HbcfStartDatePlan = {
  /** The start date to write, or null when it is already right or must not move. */
  readonly startDate: Date | null;
  /** True when the claim date differs but work has started, so it was kept. */
  readonly heldByStartedWork: boolean;
};

/**
 * Decide what the start date should become, given the requirements about to
 * be saved.
 *
 * A missing or invalid claim date decides nothing: an empty or malformed value
 * never replaces a valid start date.
 */
export async function planStartDateFromHbcfClaim(
  input: {
    readonly projectId: string;
    readonly requirements: ClaimDateSource;
    readonly currentStartDate: Date;
  },
  db: DomainDb,
): Promise<HbcfStartDatePlan> {
  const claimStart = startDateFromHbcfClaim(input.requirements);
  if (
    !claimStart
    || claimStart.getTime() === input.currentStartDate.getTime()
  ) {
    return { heldByStartedWork: false, startDate: null };
  }
  const started = await db.milestone.count({
    where: {
      projectId: input.projectId,
      status: { in: STARTED_MILESTONE_STATUSES },
    },
  });
  return started > 0
    ? { heldByStartedWork: true, startDate: null }
    : { heldByStartedWork: false, startDate: claimStart };
}

/**
 * Refuse a hand-set start date that disagrees with a recorded claim date.
 *
 * Two editable copies of one date is how they drift apart, so while a claim
 * date is recorded it is the only way to move the start. Re-sending the
 * stored start date is not a move and passes.
 */
export function assertStartDateMatchesHbcfClaim(
  requirements: ClaimDateSource,
  requestedStartDate: Date,
): void {
  const claimStart = startDateFromHbcfClaim(requirements);
  if (!claimStart || claimStart.getTime() === requestedStartDate.getTime()) {
    return;
  }
  const claim = format(
    parseISO(claimStart.toISOString().slice(0, 10)),
    "d MMM yyyy",
  );
  throw new DomainValidationError(
    `The start date follows the HBCF claim date (${claim}). Correct the claim date under Legal & Administration to move it.`,
    "startDate",
  );
}
