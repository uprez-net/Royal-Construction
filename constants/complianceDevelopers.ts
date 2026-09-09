/**
 * The estate developers whose approval a bushfire report has to carry.
 *
 * Land released as part of a master-planned estate routinely comes with a
 * covenant in the contract of sale: the developer's own consultant signs off
 * the bushfire assessment before anything goes to a council or a certifier. The
 * report is commissioned from the bushfire consultant exactly as it already is
 * — what changes is that it then has to be put in front of whoever released the
 * land, and come back approved.
 *
 * A constant rather than a table, deliberately and for now. There are a few
 * dozen of these across the Sydney growth corridors, the list changes when an
 * estate sells out rather than when anybody uses the software, and nobody has
 * asked to edit it from the screen. A table would mean a migration, a CRUD
 * screen and an empty state on day one, to hold data that is checked into the
 * repository in a form anybody can read in a diff. If it grows past the point
 * where a code change per estate is reasonable, this module is the shape the
 * table would take and `developerByKey` is the seam.
 *
 * They are deliberately NOT in the tradie directory, which is where every other
 * compliance party is picked from. A developer is not engaged, not paid and not
 * scheduled; they are asked once for a yes or a no, and putting them in the
 * directory would put them in every trade picker on the system.
 */

/**
 * One estate, and who has to approve a report on a lot inside it.
 *
 * `key` is what is stored on the outreach row and is the only field that must
 * never change: it is the link between a finished approval and the entry it was
 * sought under. Everything else is a snapshot the row copies at engagement time
 * — see `ComplianceOutreach.developerKey` — so correcting a name or an address
 * here fixes the picker without rewriting who a past approval was sought from.
 */
export type AreaDeveloper = {
  /** Stable id, stored on the outreach. Never re-used and never re-spelled. */
  key: string;
  /** The company that released the land. */
  name: string;
  /** The estate as the contract of sale names it. */
  estate: string;
  /**
   * Where the approval request goes.
   *
   * Null where we do not hold one yet, which is the honest state for most of
   * this list: an estate's approvals address is on the covenant paperwork
   * rather than published, and a wrong address is very much worse than a blank
   * one — the request appears to have been sent, the clock starts, and eleven
   * business days later the file is chasing a bounce nobody read.
   *
   * Null does not disable the entry. The connect modal prefills whatever is
   * here and always lets the address be typed or corrected before the send, so
   * an estate with no address on file is one extra field rather than a blocked
   * job. Filling it in here is what saves the next person that typing.
   */
  contactEmail: string | null;
  contactPhone?: string | null;
  /**
   * The councils this estate falls under, matched against `Project.council`.
   *
   * Used to sort the picker, never to filter it: an estate that straddles a
   * boundary, a council that has been amalgamated since the release, and a
   * project whose council was typed slightly differently are all normal, and a
   * hard filter on any of them hides the only correct answer. The developer for
   * the area is suggested; the whole list stays reachable.
   */
  councils: readonly string[];
  /** Suburbs the estate covers, matched against the project's address. */
  suburbs: readonly string[];
};

/**
 * The list, as it stands.
 *
 * Bushfire-prone releases in the north-west and south-west growth areas, which
 * is where the covenant actually bites. Ordered by council so a diff adding one
 * reads in place.
 *
 * Addresses are left null rather than guessed. See `AreaDeveloper.contactEmail`
 * — the picker prefills what is here and asks for the rest, so an entry with no
 * address costs one field at engagement time and a wrong one costs a fortnight.
 */
export const AREA_DEVELOPERS: readonly AreaDeveloper[] = [
  {
    key: "gables-box-hill",
    name: "Celestino",
    estate: "The Gables",
    contactEmail: null,
    councils: ["The Hills Shire Council"],
    suburbs: ["Box Hill", "Nelson"],
  },
  {
    key: "north-kellyville-release",
    name: "Landcom",
    estate: "North Kellyville Release Area",
    contactEmail: null,
    councils: ["The Hills Shire Council"],
    suburbs: ["North Kellyville", "Kellyville"],
  },
  {
    key: "elara-marsden-park",
    name: "Stockland",
    estate: "Elara",
    contactEmail: null,
    councils: ["Blacktown City Council"],
    suburbs: ["Marsden Park"],
  },
  {
    key: "willowdale-denham-court",
    name: "Stockland",
    estate: "Willowdale",
    contactEmail: null,
    councils: ["Campbelltown City Council", "Camden Council"],
    suburbs: ["Denham Court", "Leppington"],
  },
  {
    key: "oran-park-town",
    name: "Greenfields Development Company",
    estate: "Oran Park Town",
    contactEmail: null,
    councils: ["Camden Council"],
    suburbs: ["Oran Park"],
  },
  {
    key: "gledswood-hills",
    name: "Mirvac",
    estate: "Gledswood Hills",
    contactEmail: null,
    councils: ["Camden Council"],
    suburbs: ["Gledswood Hills", "Gregory Hills"],
  },
  {
    key: "wilton-greens",
    name: "Lendlease",
    estate: "Wilton Greens",
    contactEmail: null,
    councils: ["Wollondilly Shire Council"],
    suburbs: ["Wilton"],
  },
  {
    key: "menangle-park",
    name: "Dahua Group",
    estate: "Menangle Park",
    contactEmail: null,
    councils: ["Campbelltown City Council"],
    suburbs: ["Menangle Park"],
  },
];

const DEVELOPER_BY_KEY: ReadonlyMap<string, AreaDeveloper> = new Map(
  AREA_DEVELOPERS.map((developer) => [developer.key, developer]),
);

/**
 * The entry a stored key names, or null.
 *
 * Null for a key whose entry has since been removed, which the tab renders off
 * the outreach's own snapshot instead. That is the reason the row copies the
 * name and the address rather than pointing at this list: an approval that was
 * genuinely sought and genuinely granted must still read correctly after the
 * estate sells out and the entry goes.
 */
export function developerByKey(
  key: string | null | undefined,
): AreaDeveloper | null {
  if (!key) return null;
  return DEVELOPER_BY_KEY.get(key) ?? null;
}

/** Casefolded, punctuation-stripped, for comparing a council or a suburb. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Whether a project's address looks like it is in one of an estate's suburbs.
 *
 * A substring match on a normalised address rather than a parsed suburb field,
 * because there is no parsed suburb field: `Project.location` is one free-text
 * line. The comparison is padded on both sides so "Nelson" does not match
 * "Nelsons Ridge Road" — the suburb has to appear as whole words.
 */
function addressMentions(location: string, suburb: string): boolean {
  return ` ${normalise(location)} `.includes(` ${normalise(suburb)} `);
}

/**
 * The list, with the entries that look right for this lot first.
 *
 * Ordered rather than filtered, which is the whole point. The three ways of
 * recognising an estate from a project row — its council, its suburb, its
 * address — are each individually wrong often enough that a filter built on any
 * of them would hide the correct answer on a job that straddles a boundary or
 * whose council was typed a shade differently. So every developer stays
 * selectable and the likely ones are simply at the top, with `suggested` saying
 * which those are so the picker can label them.
 */
export function developersForArea(params: {
  council: string | null | undefined;
  location: string | null | undefined;
}): { developer: AreaDeveloper; suggested: boolean }[] {
  const council = params.council ? normalise(params.council) : "";
  const location = params.location ?? "";

  const scored = AREA_DEVELOPERS.map((developer) => {
    const bySuburb = location
      ? developer.suburbs.some((suburb) => addressMentions(location, suburb))
      : false;
    const byCouncil = council
      ? developer.councils.some((name) => normalise(name) === council)
      : false;

    // A suburb match is worth more than a council one: a council covers dozens
    // of estates and a suburb usually covers one.
    return {
      developer,
      suggested: bySuburb || byCouncil,
      rank: bySuburb ? 0 : byCouncil ? 1 : 2,
    };
  });

  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.developer.estate.localeCompare(b.developer.estate),
    )
    .map(({ developer, suggested }) => ({ developer, suggested }));
}

/**
 * How long the developer has before anybody is chased, in NSW business days.
 *
 * Their own figure rather than the eleven every consultant gets, and it is the
 * same number by coincidence rather than by sharing: a developer's approval
 * goes to an external consultant of theirs and comes back through their
 * customer service desk, which is the ten to eleven working days they quote.
 * Kept here beside the list it belongs to so changing one estate's expectations
 * later is a change in one file.
 */
export const DEVELOPER_RESPONSE_BUSINESS_DAYS = 11;

/**
 * How long the bushfire consultant has to re-issue a report the developer
 * rejected.
 *
 * Measured from the rejection being passed on rather than from the original
 * engagement, for the reason every revision clock here is: the consultant is
 * being asked for something new, and a threshold measured from an engagement
 * months earlier would be past on the day it was requested.
 */
export const BUSHFIRE_REVISION_BUSINESS_DAYS = 11;
