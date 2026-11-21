import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { EMAIL_FOOTER_HTML } from "@/constants/email-artifacts";
import { generateInPersonConsultationEmail } from "@/lib/graph/Email/in-person-consultation-email";
import { renderClientEmailHtml } from "@/lib/leads/lead-email-send";
import { projectWhatsAppInviteHtml } from "@/lib/domain/projects/whatsapp/invite";
import { generateTradieRequestEmail } from "@/utils/generate-email";

// A font stack written with double quotes ("Segoe UI") closes a style="..."
// attribute at its first quote and silently drops the rest of the declaration.
// Every renderer must write the stack single-quoted.
const DOUBLE_QUOTED_FONT = /"(Segoe UI|IBM Plex Mono|Times New Roman)"/;

describe("client email font stacks inside style attributes", () => {
  it("the tradie request email", () => {
    const { html } = generateTradieRequestEmail({
      subject: "Request",
      tradieName: "Ace Plumbing",
      projectName: "Oran Park",
      trade: "Plumbing",
      activities: [
        {
          name: "Rough-in",
          stage: "Frame",
          scheduledDate: "2026-11-20",
          durationDays: 2,
          workLines: ["Rough-in"],
        },
      ],
      reference: "RCTBK-0123456789AB",
      siteManager: { name: "", email: "", phone: "" },
    });
    assert.doesNotMatch(html, DOUBLE_QUOTED_FONT);
    assert.match(
      html,
      /font-family:Manrope, 'Segoe UI', Helvetica, Arial, sans-serif/,
    );
  });

  it("the in-person consultation email, including its heading", () => {
    const { html } = generateInPersonConsultationEmail({
      name: "Sam",
      formattedDate: "Saturday 6 June 2026",
      formattedTime: "10:00 am - 11:00 am (AEST)",
      venue: "38/62 Turner RD, Smeaton Grange NSW",
      signatureEmail: "info@royalconstructions.com.au",
    });
    assert.doesNotMatch(html, DOUBLE_QUOTED_FONT);
    assert.match(
      html,
      /font-family:Georgia, 'Times New Roman', serif;\s*font-size:30px/,
    );
  });

  it("the WhatsApp invite", () => {
    const html = projectWhatsAppInviteHtml({
      body: "Join the group.",
      inviteLink: "https://chat.whatsapp.com/abc",
      senderName: "Sam",
    });
    assert.doesNotMatch(html, DOUBLE_QUOTED_FONT);
  });

  it("the composed client email wrapper and the footer", () => {
    assert.doesNotMatch(renderClientEmailHtml("Hello"), DOUBLE_QUOTED_FONT);
    assert.doesNotMatch(EMAIL_FOOTER_HTML, DOUBLE_QUOTED_FONT);
  });
});
