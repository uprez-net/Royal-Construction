// Who a project's progress claims are addressed to.
//
// One contract can name several owners, and every one of them is a party to
// the invoice. Xero bills one contact per invoice, so a project gets ONE
// contact of its own:
//
//   - named as the contract names its owners ("Jane Smith & John Smith"), so
//     the invoice is addressed to every party that signed;
//   - reached through the PRIMARY owner (the first on the contract): their
//     email, phone and address are the contact's own;
//   - with every co-owner as a contact person on invoice emails, so each of
//     them receives the claim too.
//
// The contact belongs to the project, not to a customer. A contact person
// lives on the contact, so a per-customer contact would carry one build's
// co-owners into every other build that customer is primary on, and email
// their invoices to people who are not party to them.
//
// Pure: the Xero adapter (`lib/xero/contact.ts`) turns this into API calls,
// both straight after the project is created and at its first claim.

/**
 * Xero's documented limit on contact persons per contact. More co-owners than
 * this still become customers on the project; the ones past the limit are
 * reported in `omittedOwners` rather than silently left off the emails.
 */
export const XERO_MAX_CONTACT_PERSONS = 5;

/** Xero's maximum contact name length. */
const XERO_MAX_NAME_LENGTH = 255;

/** An owner as the billing contact needs them; legacy customers lack an address. */
export type BillingOwner = {
  readonly name: string;
  readonly email: string;
  /** Optional: some clients give no phone. */
  readonly phone: string | null;
  readonly address: string | null;
};

export type BillingContactPerson = {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
};

export type ProjectBillingContact = {
  readonly name: string;
  readonly email: string;
  /** `null` when the primary owner has none; Xero gets no phone then. */
  readonly phone: string | null;
  readonly address: string | null;
  /** Every co-owner, in contract order, up to Xero's limit. */
  readonly contactPersons: readonly BillingContactPerson[];
  /** Co-owners past Xero's limit, who will not receive invoice emails. */
  readonly omittedOwners: readonly string[];
};

/** "Jane", "Jane & John", "Jane, John & Alex": the owners as the contract lists them. */
export function billingContactName(names: readonly string[]): string {
  const trimmed = names.map((name) => name.trim()).filter(Boolean);
  if (trimmed.length <= 1) return trimmed[0] ?? "";
  return `${trimmed.slice(0, -1).join(", ")} & ${trimmed[trimmed.length - 1]}`;
}

/**
 * The name to fall back to when another Xero contact already has the owners'
 * name and is not theirs (a different Jane Smith). The site tells the office
 * which build it is, and Xero requires contact names to be unique.
 */
export function disambiguatedContactName(name: string, site: string): string {
  const suffix = ` (${site.trim()})`;
  return name.slice(0, XERO_MAX_NAME_LENGTH - suffix.length) + suffix;
}

/** "Jane Mary Smith" → first "Jane Mary", last "Smith"; one word is a first name. */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

/** Emails as Xero is sent and compared them: trimmed and lower-cased. */
function contactEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The billing contact for a project's owners, primary first.
 *
 * Every value is normalised here, once, rather than at each use. Owners a
 * project is created with already are (`requireProjectOwners`), but a project
 * from before owners were checked reaches this through its legacy customer,
 * whose email was stored as typed: " Jane@Example.com " would otherwise go to
 * Xero with the spaces and fail to match the contact Xero already has.
 *
 * Throws on an empty list: every project has at least one owner
 * (`requireProjectOwners`), so an empty list here is a caller that read the
 * wrong thing, and a contact with no name is not worth creating.
 */
export function projectBillingContact(
  owners: readonly BillingOwner[],
): ProjectBillingContact {
  const [primary, ...coOwners] = owners;
  if (!primary) {
    throw new Error("A project's billing contact needs at least one owner.");
  }

  return {
    address: primary.address?.trim() || null,
    contactPersons: coOwners
      .slice(0, XERO_MAX_CONTACT_PERSONS)
      .map((owner) => ({
        ...splitName(owner.name),
        email: contactEmail(owner.email),
      })),
    email: contactEmail(primary.email),
    name: billingContactName(owners.map((owner) => owner.name)).slice(
      0,
      XERO_MAX_NAME_LENGTH,
    ),
    omittedOwners: coOwners
      .slice(XERO_MAX_CONTACT_PERSONS)
      .map((owner) => owner.name.trim()),
    phone: primary.phone?.trim() || null,
  };
}
