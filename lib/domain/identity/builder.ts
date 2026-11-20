// Who the builder is: Royal Constructions itself.
//
// Every contract this business signs names two sides, the Builder and the
// Owner(s), and the builder's own name, licence, phone and email are printed
// all over both documents — the header, the WHO section, the signature block,
// the footer. An extraction that reads "the party with a name, an email and a
// phone" will happily take the builder for an owner, and an owner is what a
// customer and a Xero contact are made from: the business would invoice
// itself and send the client's notices to its own inbox.
//
// These are the facts the owner rule (`../projects/owners.ts`) and the
// extraction prompt use to tell the builder apart from a client. Pure data,
// Node-safe, no imports.

export const BUILDER_IDENTITY = {
  tradingName: "Royal Constructions",
  legalName: "Royal Constructions Pty Ltd",
  licenceNumber: "383992C",
  abn: "56 644 111 580",
  officeAddress: "Unit 3, 36 Turner Road Smeaton Grange NSW 2567",
  /** Every `@` address on this domain is the builder's: info@, admin@, staff. */
  emailDomain: "royalconstructions.com.au",
  /** As printed. Compared in `canonicalPhone` form. */
  phones: ["1300 832 355", "0406 555 565", "+61 406 555 565"],
} as const;
