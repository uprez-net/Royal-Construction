import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  isPlanningAuthorityDomain,
  looksLikePlanningNotification,
  mentionsPlanningMatter,
  normaliseReference,
  planningReferencesIn,
  readPortalDetermination,
} from "@/lib/graph/planning-portal";

/**
 * Recognising a planning authority's mail without an address to recognise it
 * by.
 *
 * The tests worth having here are the ones about the boundary rather than the
 * happy path: what a council sends is easy to accept, and the whole risk is in
 * what else gets accepted with it. Every case below is a message that satisfies
 * one or two of the three layers and must still not correlate.
 */

const ORIGINAL_ENV = {
  domains: process.env.PLANNING_AUTHORITY_DOMAINS,
  address: process.env.NSW_PLANNING_PORTAL_EMAIL,
};

afterEach(() => {
  process.env.PLANNING_AUTHORITY_DOMAINS = ORIGINAL_ENV.domains;
  process.env.NSW_PLANNING_PORTAL_EMAIL = ORIGINAL_ENV.address;
});

describe("planning authority domains", () => {
  it("accepts the portal, the department and any NSW council", () => {
    assert.equal(isPlanningAuthorityDomain("planningportal.nsw.gov.au"), true);
    assert.equal(isPlanningAuthorityDomain("planning.nsw.gov.au"), true);
    assert.equal(isPlanningAuthorityDomain("camden.nsw.gov.au"), true);
    assert.equal(isPlanningAuthorityDomain("thehills.nsw.gov.au"), true);
  });

  it("accepts the subdomains a case management system sends from", () => {
    assert.equal(
      isPlanningAuthorityDomain("notifications.camden.nsw.gov.au"),
      true,
    );
    assert.equal(isPlanningAuthorityDomain("mail.planning.nsw.gov.au"), true);
  });

  it("refuses a lookalike that merely ends with the suffix", () => {
    // The reason the suffix match is anchored on a dot. Without it, anybody who
    // can register a domain can be a NSW council.
    assert.equal(
      isPlanningAuthorityDomain("planningportal.nsw.gov.au.example.com"),
      false,
    );
    assert.equal(isPlanningAuthorityDomain("notnsw.gov.au"), false);
    assert.equal(isPlanningAuthorityDomain("nsw.gov.au.attacker.net"), false);
  });

  it("refuses an ordinary correspondent", () => {
    assert.equal(isPlanningAuthorityDomain("gmail.com"), false);
    assert.equal(isPlanningAuthorityDomain("bigarchitects.com.au"), false);
    assert.equal(isPlanningAuthorityDomain(null), false);
    assert.equal(isPlanningAuthorityDomain(""), false);
  });

  it("takes the councils on a private platform from the environment", () => {
    process.env.PLANNING_AUTHORITY_DOMAINS = "@dataworks.example, foo.example";
    assert.equal(isPlanningAuthorityDomain("dataworks.example"), true);
    assert.equal(isPlanningAuthorityDomain("mail.foo.example"), true);
    assert.equal(isPlanningAuthorityDomain("other.example"), false);
  });
});

describe("planning vocabulary", () => {
  it("recognises what these systems actually send", () => {
    assert.equal(
      mentionsPlanningMatter(
        "Request for Additional Information - DA-2026/0412",
      ),
      true,
    );
    assert.equal(mentionsPlanningMatter("Notice of Determination", null), true);
    assert.equal(mentionsPlanningMatter("Case PAN-1234567 updated"), true);
  });

  it("reads the body when the subject says nothing", () => {
    // The case the body argument exists for: portal subjects are routinely
    // bare, with everything that identifies the matter in the message.
    assert.equal(
      mentionsPlanningMatter(
        "Your application has been updated",
        "The consent authority has requested further information.",
      ),
      true,
    );
  });

  it("stays quiet on ordinary building correspondence", () => {
    assert.equal(mentionsPlanningMatter("Revised plans attached"), false);
    assert.equal(
      mentionsPlanningMatter("Invoice 4471", "Payment terms"),
      false,
    );
    assert.equal(mentionsPlanningMatter("", ""), false);
    assert.equal(mentionsPlanningMatter(null, null), false);
  });
});

describe("application references", () => {
  it("finds the shapes councils and the portal quote", () => {
    const refs = planningReferencesIn(
      "DA-2026/0412 and case PAN-1234567 refer",
    );
    assert.ok(refs.has(normaliseReference("DA-2026/0412")));
    assert.ok(refs.has(normaliseReference("PAN-1234567")));
  });

  it("normalises both sides so punctuation cannot break a match", () => {
    // The whole reason `normaliseReference` is exported: a council quoting
    // "DA 2026/0412" against our stored "DA-2026/0412" is the same reference,
    // and normalising only one side is the bug this prevents.
    const refs = planningReferencesIn("Re: DA 2026/0412");
    assert.ok(refs.has(normaliseReference("DA-2026/0412")));
  });

  it("drops references too short to identify anything", () => {
    // A council that recorded "12" as its number would otherwise match any
    // message containing a twelve.
    const refs = planningReferencesIn("Job 12 and lot 7");
    assert.equal(refs.size, 0);
  });

  it("finds nothing in a message that quotes none", () => {
    assert.equal(planningReferencesIn("Notice of Determination").size, 0);
  });
});

describe("the two cheap layers together", () => {
  const planningSubject = "Request for Additional Information - DA-2026/0412";

  it("passes a council writing about a planning matter", () => {
    assert.equal(
      looksLikePlanningNotification({
        fromEmail: "eplanning@camden.nsw.gov.au",
        domain: "camden.nsw.gov.au",
        subject: planningSubject,
      }),
      true,
    );
  });

  it("refuses a planning matter from somebody who is not an authority", () => {
    // The architect emailing about the DA. Layer two holds, layer one does not,
    // and this is exactly the message that must not be filed as the council's.
    assert.equal(
      looksLikePlanningNotification({
        fromEmail: "jo@bigarchitects.com.au",
        domain: "bigarchitects.com.au",
        subject: planningSubject,
      }),
      false,
    );
  });

  it("refuses an authority writing about something else", () => {
    // Layer one holds, layer two does not. A council emails about rates,
    // waste collection and a dozen other things.
    assert.equal(
      looksLikePlanningNotification({
        fromEmail: "rates@camden.nsw.gov.au",
        domain: "camden.nsw.gov.au",
        subject: "Your rates notice is ready",
        body: "Quarterly instalment due 30 April.",
      }),
      false,
    );
  });

  it("still honours a configured address on a commercial domain", () => {
    process.env.NSW_PLANNING_PORTAL_EMAIL = "noreply@assessments.example";
    assert.equal(
      looksLikePlanningNotification({
        fromEmail: "noreply@assessments.example",
        domain: "assessments.example",
        subject: planningSubject,
      }),
      true,
    );
  });

  it("does not let the configured address skip the vocabulary layer", () => {
    process.env.NSW_PLANNING_PORTAL_EMAIL = "noreply@assessments.example";
    assert.equal(
      looksLikePlanningNotification({
        fromEmail: "noreply@assessments.example",
        domain: "assessments.example",
        subject: "Scheduled maintenance this weekend",
      }),
      false,
    );
  });
});

/**
 * Reading a determination off an email that carries no document.
 *
 * The one thing this module decides that has consequences beyond where a message
 * is filed: a determination stops the overdue clock and puts a green
 * "ready to download" line on somebody's project page. So the tests that matter
 * are the ones where it must say no — a refusal is also a determination, and a
 * request for information routinely arrives carrying the conditions under which
 * approval would be granted, which reads exactly like an approval.
 */
describe("reading a portal determination", () => {
  it("reads an approved CDC", () => {
    assert.equal(
      readPortalDetermination(
        "Your Complying Development Certificate has been approved",
        "CDC-2026/0188 for 14 Example St. Log in to the NSW Planning Portal to download your certificate.",
      ),
      "COMPLYING_DEVELOPMENT_CERTIFICATE",
    );
  });

  it("reads an approved construction certificate", () => {
    assert.equal(
      readPortalDetermination(
        "Construction Certificate issued",
        "The construction certificate for DA 2026/0412 has been issued and is ready for download.",
      ),
      "CONSTRUCTION_CERTIFICATE",
    );
  });

  it("reads development consent granted", () => {
    assert.equal(
      readPortalDetermination(
        "Notice of Determination — DA 2026/0412",
        "Development consent has been granted. The notice of determination is available on the portal.",
      ),
      "DEVELOPMENT_APPLICATION",
    );
  });

  it("prefers the certificate over the consent it cites", () => {
    // A construction certificate notice names the DA it follows, so a message
    // can satisfy both vocabularies. Reading it as the DA would stop the wrong
    // clock and raise a download alert for a consent that came through months
    // ago.
    assert.equal(
      readPortalDetermination(
        "CC approved — development application DA 2026/0412",
        "Your construction certificate has been approved under development consent DA 2026/0412.",
      ),
      "CONSTRUCTION_CERTIFICATE",
    );
  });

  it("refuses a refusal, however approving the rest reads", () => {
    // The case the disqualifier list exists for. A refusal quotes the
    // application's own description back, so "approved works" appears in a
    // message that is the opposite of an approval.
    assert.equal(
      readPortalDetermination(
        "Determination — CDC-2026/0188",
        "Your application for the approved works at 14 Example St has been refused.",
      ),
      null,
    );
    assert.equal(
      readPortalDetermination(
        "Complying Development Certificate — determination",
        "The certificate has not been approved. See the attached reasons.",
      ),
      null,
    );
  });

  it("refuses a request for further information", () => {
    // These arrive carrying the conditions under which approval *would* be
    // granted, which satisfies a determination phrase on its own.
    assert.equal(
      readPortalDetermination(
        "Request for additional information — DA 2026/0412",
        "Development consent can be granted once the following is provided: a shadow diagram and a revised waste plan.",
      ),
      null,
    );
  });

  it("refuses a fee notice", () => {
    assert.equal(
      readPortalDetermination(
        "Invoice for your complying development certificate",
        "A fee is payable before the certificate has been issued.",
      ),
      null,
    );
  });

  it("refuses approving words it cannot place", () => {
    // Null rather than a guess. A determination filed against the wrong
    // application stops the wrong clock and raises a download alert on a
    // certificate nobody applied for.
    assert.equal(
      readPortalDetermination(
        "Your application has been approved",
        "Log in to the portal to see the outcome.",
      ),
      null,
    );
  });

  it("refuses an empty message", () => {
    assert.equal(readPortalDetermination("", ""), null);
    assert.equal(readPortalDetermination(null, null), null);
  });
});
