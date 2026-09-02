/**
 * Restore `Date` objects on a milestone that has been through JSON.
 *
 * `SafeMilestone` types `targetDate` as `Date` and `startDate`/`actualDate` as
 * `Date | null`, and that is what they are when a milestone arrives on the RSC
 * payload — React serializes Dates as Dates. It is NOT what they are when the
 * same milestone comes back from `fetchJson`: JSON has no date type, so every
 * one of them is an ISO string, while the declared type still says `Date`.
 *
 * Redux is where the two meet. `setActiveProject` seeds the store from the
 * server payload, then a mutation merges an API response over one entry, and
 * the array ends up holding a mix — most milestones carrying real Dates and the
 * just-updated one carrying strings.
 *
 * That mix is what makes the failure look intermittent. `partitionActivities`
 * sorts settled work with `b.actualDate?.getTime()`, and `Array.prototype.sort`
 * never calls the comparator on a list of one — so the first completion in a
 * stage is fine and the second throws "actualDate.getTime is not a function",
 * taking the Milestones tab down with it. `nextActivity` and `sortActivities`
 * have the same exposure through `targetDate`.
 *
 * Reviving at the boundary, rather than coercing at each of the dozen read
 * sites, keeps one invariant true everywhere downstream: a milestone in the
 * store carries Dates.
 */
export function reviveMilestoneDates<
  T extends {
    targetDate: Date;
    startDate: Date | null;
    actualDate: Date | null;
  },
>(milestone: T): T {
  return {
    ...milestone,
    targetDate: toDate(milestone.targetDate) ?? milestone.targetDate,
    startDate: toDate(milestone.startDate),
    actualDate: toDate(milestone.actualDate),
  };
}

/**
 * A `Date`, from either a `Date` or the ISO string JSON turned it into.
 *
 * Anything unparseable becomes null rather than an Invalid Date: a null reads
 * as "no date recorded" everywhere downstream, whereas an Invalid Date poisons
 * every comparison it touches with NaN and sorts unpredictably.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
