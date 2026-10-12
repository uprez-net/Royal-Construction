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

// Regression: franc reads this body as "fra" (-4) with the footer included, and
// as English once the footer is removed. Fails on the unfixed detector.
test("the Elementor website form body is not dropped by language detection", () => {
  const result = evaluateEmail(
    FORM_SUBJECT,
    formBody({ interest: "Renovation" }),
  );

  assert.notEqual(result.language, "fra");
  assert.equal(
    result.signals.some((s) => s.code === "foreign_language"),
    false,
  );
  assert.equal(result.shouldEvaluate, true, JSON.stringify(result.signals));
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
    const result = evaluateEmail(FORM_SUBJECT, body);
    assert.equal(result.shouldEvaluate, true, body);
    assert.equal(
      result.signals.some((s) => s.code === "foreign_language"),
      false,
      body,
    );
  }
});

test("a French solicitation is still rejected", () => {
  const result = evaluateEmail("Offre spéciale", FRENCH_SOLICITATION);

  assert.equal(result.language, "fra");
  assert.equal(result.shouldEvaluate, false, JSON.stringify(result.signals));
});

test("a French solicitation wrapped in the form footer is still rejected", () => {
  const body = `${FRENCH_SOLICITATION}\r\nPage URL: https://example.com/contact/\r\nUser Agent: ${IPHONE_UA}\r\nRemote IP: 203.0.113.7\r\nPowered by: Elementor`;
  const result = evaluateEmail(FORM_SUBJECT, body);

  assert.equal(result.language, "fra");
  assert.equal(result.shouldEvaluate, false, JSON.stringify(result.signals));
});
