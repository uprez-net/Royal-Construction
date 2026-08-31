import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addressTokens,
  buildCertifierReplySubject,
  buildCertifierSubject,
  extractCertifierRefToken,
  generateCertifierRefToken,
  isPublicMailDomain,
  siteAddressCore,
  stripSubjectPrefixes,
  subjectMentionsSiteAddress,
} from "../../lib/graph/certifier-subject";
import { isMachineGenerated } from "../../lib/graph/offer-reply-classify";

const TOKEN = "RCCERT-A1B2C3D4E5F6";

test("the token is found through any number of reply prefixes", () => {
  for (const subject of [
    `[${TOKEN}] 14 Example St, Marrickville`,
    `Re: [${TOKEN}] 14 Example St, Marrickville`,
    `RE: [${TOKEN}] 14 Example St`,
    `Fw: Re: [${TOKEN}] 14 Example St`,
    `FW: RE: Re: [${TOKEN}] 14 Example St`,
    // Some clients drop the address and keep only the bracketed token.
    `Re: [${TOKEN}]`,
  ]) {
    assert.equal(extractCertifierRefToken(subject), TOKEN, subject);
  }
});

test("a lower-cased subject still resolves to the stored token", () => {
  // Stored refTokens are upper-case; a client that normalises the subject must
  // not silently orphan the whole thread.
  assert.equal(
    extractCertifierRefToken("re: [rccert-a1b2c3d4e5f6] 14 example st"),
    TOKEN,
  );
});

test("subjects without a well-formed token return null", () => {
  for (const subject of [
    "",
    null,
    undefined,
    "Re: your invoice",
    // The offer token, which must not be mistaken for a certifier one.
    "Your Building Proposal — RC-1042 [RCOFR-A1B2C3D4E5F6]",
    // Right prefix, wrong length.
    "[RCCERT-A1B2C3] 14 Example St",
    "[RCCERT-A1B2C3D4E5F6A] 14 Example St",
    // Unbracketed, so not a token we minted.
    "RCCERT-A1B2C3D4E5F6 14 Example St",
    // Non-hex.
    "[RCCERT-Z1B2C3D4E5F6] 14 Example St",
  ]) {
    assert.equal(extractCertifierRefToken(subject), null, String(subject));
  }
});

test("a bounce quoting the token is rejected before it reaches an engagement", () => {
  // The bounce carries the token, because a DSN quotes the original subject.
  // Correlation succeeding is the point — what stops it being treated as the
  // certifier replying is isMachineGenerated, not the subject.
  const subject = `Undeliverable: [${TOKEN}] 14 Example St`;
  assert.equal(extractCertifierRefToken(subject), TOKEN);

  assert.equal(isMachineGenerated({ autoSubmitted: "auto-replied" }), true);
  assert.equal(isMachineGenerated({ returnPath: "<>" }), true);
  assert.equal(
    isMachineGenerated({
      contentType: 'multipart/report; report-type=delivery-status',
    }),
    true,
  );
  // A genuine reply from the certifier's own client.
  assert.equal(isMachineGenerated({ autoSubmitted: "no" }), false);
  assert.equal(isMachineGenerated({}), false);
});

test("minted tokens round-trip through a built subject", () => {
  for (let i = 0; i < 50; i += 1) {
    const token = generateCertifierRefToken();
    const subject = buildCertifierSubject(token, "14 Example St, Marrickville");
    assert.equal(extractCertifierRefToken(subject), token);
    assert.equal(extractCertifierRefToken(buildCertifierReplySubject(subject)), token);
  }
});

test("the reply prefix is added once and never stacked", () => {
  const subject = buildCertifierSubject(TOKEN, "14 Example St");
  const once = buildCertifierReplySubject(subject);
  assert.equal(once, `Re: ${subject}`);
  // Replying to a reply must not produce "Re: Re: Re: …" over a long thread.
  assert.equal(buildCertifierReplySubject(once), once);
  assert.equal(buildCertifierReplySubject(`RE: ${subject}`), `RE: ${subject}`);
});

// ---------------------------------------------------------------------------
// Address fallback
// ---------------------------------------------------------------------------
//
// The certifier's own subject, which is what actually arrives once the office
// has retyped ours: their job number, then the site.
const ENGAGEMENT_ADDRESS = "14 Example St, Marrickville NSW 2204";

test("a certifier's own job number and address correlate to the engagement", () => {
  for (const subject of [
    "260449-11 14 Example St, Marrickville",
    "Re: 260449-11 14 Example St, Marrickville",
    "RE: FW: 260449-11 14 Example Street, Marrickville NSW 2204",
    // The suburb, state and postcode are the first things dropped.
    "260449-11 14 Example Street",
    // Their reference in a shape of its own, and a note of their own after.
    "J240188 - 14 Example St Marrickville - Fee Proposal",
    "26-0449 | 14 Example Street, Marrickville - CDC application",
    // No reference at all, which is just as common.
    "14 Example St Marrickville - documents attached",
  ]) {
    assert.equal(
      subjectMentionsSiteAddress(subject, ENGAGEMENT_ADDRESS),
      true,
      subject,
    );
  }
});

test("street type abbreviations are the same address either way round", () => {
  // Whichever side spells it out. This is the single most common difference
  // between what was typed into the engagement and what comes back.
  assert.equal(subjectMentionsSiteAddress("14 Example Street", "14 Example St"), true);
  assert.equal(subjectMentionsSiteAddress("14 Example St", "14 Example Street"), true);
  assert.equal(subjectMentionsSiteAddress("9 Ash Rd", "9 Ash Road, Kellyville"), true);
  assert.equal(subjectMentionsSiteAddress("2 Grand Pde", "2 Grand Parade"), true);
  assert.equal(subjectMentionsSiteAddress("7 Oak Cres, Ryde", "7 Oak Crescent"), true);
  // Case and punctuation carry no meaning either.
  assert.equal(
    subjectMentionsSiteAddress("14 EXAMPLE ST., MARRICKVILLE", ENGAGEMENT_ADDRESS),
    true,
  );
});

test("unit markers and separators do not decide the match", () => {
  assert.equal(
    subjectMentionsSiteAddress("3/14 Example St", "Unit 3/14 Example Street"),
    true,
  );
  assert.equal(
    subjectMentionsSiteAddress("Unit 3, 14 Example Street", "3/14 Example St"),
    true,
  );
  assert.equal(
    subjectMentionsSiteAddress("260449-11 14-16 Example St", "14-16 Example Street"),
    true,
  );
});

test("a different site is not correlated onto this engagement", () => {
  for (const subject of [
    // The number is the thing nobody gets wrong, so a different one is a
    // different job — including the neighbour.
    "260449-11 16 Example St, Marrickville",
    "260449-11 14A Example St, Marrickville",
    // Same number and name, different street.
    "260449-11 14 Example Road, Marrickville",
    // The street with no number on it at all.
    "260449-11 Example Street, Marrickville",
    // The suburb alone is not the site.
    "260449-11 Marrickville job - fee proposal",
    "Re: your invoice",
    "",
  ]) {
    assert.equal(
      subjectMentionsSiteAddress(subject, ENGAGEMENT_ADDRESS),
      false,
      subject,
    );
  }
  assert.equal(subjectMentionsSiteAddress(null, ENGAGEMENT_ADDRESS), false);
  assert.equal(subjectMentionsSiteAddress(undefined, ENGAGEMENT_ADDRESS), false);
});

test("the certifier's job number cannot stand in for a street number", () => {
  // "260449-11 Smith Street" is a job number and a street: the site number is
  // missing. Reading the tail of their reference as one would file the
  // documents against 11 Smith St, which is a different project.
  assert.equal(
    subjectMentionsSiteAddress("260449-11 Smith Street", "11 Smith St, Newtown"),
    false,
  );
  assert.equal(
    subjectMentionsSiteAddress("26-0449 Smith St", "449 Smith Street"),
    false,
  );
  // A street number is never five digits, and a range is never three on the
  // left, so neither is mistaken for a reference.
  assert.equal(
    subjectMentionsSiteAddress("14-16 Example St", "14-16 Example Street"),
    true,
  );
  assert.equal(stripSubjectPrefixes("Re: 260449-11 14 Example St"), "14 Example St");
  assert.equal(stripSubjectPrefixes("14 Example St"), "14 Example St");
});

test("the address has to be one run of words, not words scattered about", () => {
  // Both halves are present and the subject is about neither.
  assert.equal(
    subjectMentionsSiteAddress(
      "14 invoices outstanding on Example Street jobs",
      "14 Example St",
    ),
    false,
  );
});

test("an address too thin to correlate on opts out entirely", () => {
  // No number: whatever this matches, it matches far too much of it. The
  // message goes to the lead path instead, which is where it went before the
  // fallback existed.
  for (const address of ["", "Marrickville", "Sydney NSW", "The Corner Store"]) {
    assert.deepEqual(siteAddressCore(address), []);
    assert.equal(subjectMentionsSiteAddress(`260449-11 ${address}`, address), false);
  }
  assert.deepEqual(siteAddressCore(ENGAGEMENT_ADDRESS), [
    "14",
    "example",
    "street",
  ]);
  // A lot number is a street number on a greenfield site.
  assert.deepEqual(siteAddressCore("Lot 24 Fairway Drive, Box Hill"), [
    "lot",
    "24",
    "fairway",
    "drive",
  ]);
});

test("a leading abbreviation is a name, not a street type", () => {
  // "St Marys" is a suburb and a saint. Expanding the first token would turn
  // it into "Street Marys" and end the core before the street was reached.
  assert.deepEqual(siteAddressCore("12 Mamre Rd, St Marys NSW 2760"), [
    "12",
    "mamre",
    "road",
  ]);
  assert.equal(
    subjectMentionsSiteAddress("260449-11 12 Mamre Road St Marys", "12 Mamre Rd, St Marys"),
    true,
  );
  assert.deepEqual(addressTokens("St Marys"), ["st", "marys"]);
});

test("the state and the postcode are dropped, and only from the tail", () => {
  assert.deepEqual(addressTokens(ENGAGEMENT_ADDRESS), [
    "14",
    "example",
    "street",
    "marrickville",
  ]);
  // Before a street type they are part of the name, not the tail: a street
  // named after a state, and a four-digit street number.
  assert.deepEqual(addressTokens("1 Victoria Rd, Rozelle"), [
    "1",
    "victoria",
    "road",
    "rozelle",
  ]);
  assert.deepEqual(siteAddressCore("2500 Nowra Rd, Nowra NSW 2541"), [
    "2500",
    "nowra",
    "road",
  ]);
  assert.equal(
    subjectMentionsSiteAddress("260449-11 2500 Nowra Road", "2500 Nowra Rd, Nowra NSW 2541"),
    true,
  );
});

test("a public mailbox domain is not evidence of who is writing", () => {
  // The sender guard in the notifications route falls back to the full address
  // on these, because the homeowner writing about the same site is on one too.
  for (const domain of ["gmail.com", "GMAIL.COM", " hotmail.com ", "bigpond.com"]) {
    assert.equal(isPublicMailDomain(domain), true, domain);
  }
  for (const domain of ["certifierco.com.au", "bluegumcertifiers.com", "", null, undefined]) {
    assert.equal(isPublicMailDomain(domain), false, String(domain));
  }
});

test("the token still wins where it survived, and the address never contradicts it", () => {
  // Both correlations on one subject — our outreach, replied to intact. The
  // route reads the token first and never reaches the address.
  const subject = `Re: [${TOKEN}] ${ENGAGEMENT_ADDRESS}`;
  assert.equal(extractCertifierRefToken(subject), TOKEN);
  assert.equal(subjectMentionsSiteAddress(subject, ENGAGEMENT_ADDRESS), true);
});
