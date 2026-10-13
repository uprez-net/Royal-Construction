import assert from "node:assert/strict";
import { test } from "vitest";

import { evaluateEmail } from "@/utils/spam-detector";

// Fake personal details only. Never copy a real enquiry into these tests.
const FORM_SUBJECT = '"I want to build" Form Submission';

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// Graph returns the body as plain text (Prefer: outlook.body-content-type="text"),
// one field per line.
function formBody(
  overrides: { interest?: string; message?: string; userAgent?: string } = {},
): string {
  return [
    "Name: Test Person",
    "Postcode: 2000",
    "Phone: 0400000000",
    "Email: test@example.com",
    `What are you interested in? (optional): ${overrides.interest ?? "House and Granny Flat"}`,
    `Message (optional): ${overrides.message ?? ""}`,
    "---",
    "Date: March 3, 2026",
    "Time: 10:15 am",
    "Page URL: https://example.com/contact/",
    `User Agent: ${overrides.userAgent ?? IPHONE_UA}`,
    "Remote IP: 203.0.113.7",
    "Powered by: Elementor",
  ].join("\r\n");
}

const LONG_MESSAGE =
  "We would like a quote to build a granny flat at the back of our property this spring. Please call to discuss the plans.";

const FRENCH_SOLICITATION =
  "Bonjour, je vous contacte pour vous proposer nos services de rénovation et de nettoyage de façade à un prix exceptionnel. Nous sommes une entreprise sérieuse avec une longue expérience dans le domaine et nous serions ravis de discuter de votre projet.";

// The real headers Graph returns for an Elementor notification: sent by our own
// mailbox, with the client's address in Reply-To.
const FORM_HEADERS = {
  from: '"info - Royal Constructions" <info@royalconstructions.com.au>',
  replyTo: '"Test Person" <test@example.com>',
  returnPath: "info@royalconstructions.com.au",
};

// Regression: the From/Reply-To domain mismatch (-3) dropped every form that
// carried no construction keywords, e.g. "House and Granny Flat" with no message.
test("a website form relayed by our own mailbox is not penalised for Reply-To mismatch", () => {
  const result = evaluateEmail(FORM_SUBJECT, formBody(), FORM_HEADERS);

  assert.equal(
    result.signals.some((s) => s.code === "suspicious_sender_domain"),
    false,
  );
  assert.equal(result.shouldEvaluate, true, JSON.stringify(result.signals));
});

// Regression: franc reads this body as "fra" (-4) with the footer included, and
// as English once the footer is removed.
test("the Elementor footer does not make an English form read as another language", () => {
  const result = evaluateEmail(
    FORM_SUBJECT,
    formBody({ interest: "Extension" }),
    FORM_HEADERS,
  );

  assert.notEqual(result.language, "fra");
  assert.equal(
    result.signals.some((s) => s.code === "foreign_language"),
    false,
  );
  assert.equal(result.shouldEvaluate, true, JSON.stringify(result.signals));
});

test("a French solicitation wrapped in the form footer is still rejected", () => {
  const body = `${FRENCH_SOLICITATION}\r\nPage URL: https://example.com/contact/\r\nUser Agent: ${IPHONE_UA}\r\nRemote IP: 203.0.113.7\r\nPowered by: Elementor`;
  const result = evaluateEmail(FORM_SUBJECT, body, FORM_HEADERS);

  assert.equal(result.language, "fra");
  assert.equal(result.shouldEvaluate, false, JSON.stringify(result.signals));
});

test("form variants with a message, other interests and a desktop user agent pass", () => {
  const variants = [
    formBody({ message: LONG_MESSAGE }),
    formBody({ interest: "Extension" }),
    formBody({
      interest: "Other",
      message: LONG_MESSAGE,
      userAgent: DESKTOP_UA,
    }),
  ];

  for (const body of variants) {
    const result = evaluateEmail(FORM_SUBJECT, body, FORM_HEADERS);
    assert.equal(result.shouldEvaluate, true, JSON.stringify(result.signals));
  }
});

test("a Reply-To mismatch from a third-party sender is still penalised", () => {
  const result = evaluateEmail(FORM_SUBJECT, formBody(), {
    from: "Sales <sales@vendor-example.com>",
    replyTo: "<other@elsewhere-example.com>",
  });

  assert.equal(
    result.signals.some((s) => s.code === "suspicious_sender_domain"),
    true,
  );
});

test("a French solicitation relayed through our own mailbox is still rejected", () => {
  const result = evaluateEmail(FORM_SUBJECT, FRENCH_SOLICITATION, FORM_HEADERS);

  assert.equal(result.shouldEvaluate, false, JSON.stringify(result.signals));
});

test("a forged own-mailbox From with a foreign Return-Path is still penalised", () => {
  const result = evaluateEmail(FORM_SUBJECT, formBody(), {
    ...FORM_HEADERS,
    returnPath: "bounce@spammer-example.com",
  });

  assert.equal(
    result.signals.some((s) => s.code === "suspicious_sender_domain"),
    true,
  );
});

test("the footer is only ignored when it is the real four-line block ending the message", () => {
  // The loose rule cut everything after the first "Page URL:", hiding the
  // French from detection. The words alone are not a footer.
  const mentionsFooter = `Bonjour.\r\nPage URL: see below.\r\n${FRENCH_SOLICITATION}\r\nRemote IP: n/a\r\n${FRENCH_SOLICITATION}`;
  const result = evaluateEmail(FORM_SUBJECT, mentionsFooter, FORM_HEADERS);

  assert.equal(result.language, "fra");
  assert.equal(result.shouldEvaluate, false, JSON.stringify(result.signals));
});
