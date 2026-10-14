import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { generateInPersonConsultationEmail } from "@/lib/graph/Email/in-person-consultation-email";
import { DEFAULT_CONSULTATION_VENUE } from "@/lib/leads/consultation-venue";

const BASE = {
  name: "Jaswinder Singh",
  formattedDate: "Saturday 17 October 2026",
  formattedTime: "10:00 am - 11:00 am (AEDT)",
  venue: DEFAULT_CONSULTATION_VENUE,
  signatureEmail: "info@royalconstructions.com.au",
};

describe("generateInPersonConsultationEmail", () => {
  it("carries the date, time, venue and the team signature", () => {
    const { subject, html } = generateInPersonConsultationEmail(BASE);

    assert.match(subject, /Saturday 17 October 2026/);
    assert.match(html, /Dear Jaswinder Singh,/);
    assert.match(html, /10:00 am - 11:00 am \(AEDT\)/);
    assert.ok(html.includes(DEFAULT_CONSULTATION_VENUE));
    assert.match(html, /Royal Constructions Team/);
    assert.match(html, /mailto:info@royalconstructions\.com\.au/);
    assert.ok(
      html.includes(encodeURIComponent(DEFAULT_CONSULTATION_VENUE)),
      "the directions link should search for the venue",
    );
  });

  // The booking form is on the open internet, and this email is sent from the
  // company mailbox to an address the visitor typed.
  it("escapes everything the visitor typed", () => {
    const { html } = generateInPersonConsultationEmail({
      ...BASE,
      name: '<img src=x onerror="alert(1)">',
      venue: '<a href="https://evil.example">Click</a>',
      agenda: "<script>alert(1)</script>\nSecond line",
    });

    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes('<a href="https://evil.example">'));
    assert.match(
      html,
      /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Second line/,
    );
  });

  it("leaves the agenda row out when there is no agenda", () => {
    const withAgenda = generateInPersonConsultationEmail({
      ...BASE,
      agenda: "Granny flat on a 550 m² block",
    }).html;
    const without = generateInPersonConsultationEmail({
      ...BASE,
      agenda: "   ",
    }).html;

    assert.match(withAgenda, /Agenda/);
    assert.match(withAgenda, /Granny flat on a 550 m² block/);
    assert.doesNotMatch(without, /Agenda/);
  });
});
