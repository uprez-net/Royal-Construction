// The site address a new compliance engagement is filed under.
//
// It becomes the subject of every party and certifier email on the file, and
// the inbound fallback matches replies on its street core — street number
// through street type (`siteAddressCore`). A project keeps its suburb, state
// and country in `location` and its street in `name` ("Lot 9028 Sommerville
// Drive, Catherine Field 2557"), so defaulting to the location alone filed
// engagements as "Catherine Field NSW 2557, Australia": a subject with no
// street, and a core that matches any job in the suburb.
//
// The name is added only when the location has no street of its own. Most
// projects keep the street in `location` ("20 Massey St, Oran Park NSW 2570")
// and a description in `name` ("PROPOSED SINGLE STOREY DWELLING AT NO.20 ...").
// Prefixing that name moved the street core to "proposed single storey dwelling
// at 20 massey street", which a certifier writing "20 Massey St" never matches.
//
// Only the default for a new engagement. A stored address is never rewritten:
// replies on a live thread are matched against what was sent.
//
// Pure, so the compliance tab can pre-fill its field with the same value the
// agent uses when it is not given one.

export function defaultComplianceSubjectAddress(project: {
  readonly location: string;
  readonly name: string;
}): string {
  const name = project.name.trim();
  const location = project.location.trim();
  if (!name) return location;
  if (!location) return name;
  if (location.toLowerCase().includes(name.toLowerCase())) return location;
  if (hasStreetNumber(location)) return location;
  if (name.toLowerCase().includes(location.toLowerCase())) return name;
  return `${name}, ${location}`;
}

/**
 * Whether an address names a street: a number ("20", "12A", "3/45") followed
 * by a word. A postcode is not one, with or without a comma before the country
 * ("NSW 2557, Australia", "NSW 2557 Australia"): the word after it is a state,
 * territory or country, never a street name.
 */
function hasStreetNumber(address: string): boolean {
  return /(?:^|[\s,])\d+[a-z]?(?:[/-]\d+[a-z]?)?\s+(?!(?:australia|au|nsw|vic|qld|act|tas|sa|wa|nt)\b)[a-z]/i.test(
    address,
  );
}
