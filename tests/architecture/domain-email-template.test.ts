import assert from "node:assert/strict";
import { test } from "node:test";

import {
  generateEmailTemplate,
  isSafeEmailTemplateUrl,
} from "../../lib/domain/email/template";
import { adminPrincipal, customerPrincipal } from "./domain-harness";

test("email templates only retain web URLs and wrap generated HTML", async () => {
  let receivedPrompt = "";
  const result = await generateEmailTemplate(
    adminPrincipal(),
    {
      attachments: [
        { label: "plan.pdf", url: "https://blob.test/plan.pdf" },
        { label: "unsafe", url: "javascript:alert(1)" },
      ],
      description: "Send the client the updated plan.",
      links: [{ label: "Portal", url: "https://example.test/portal" }],
      systemInstruction: "system",
    },
    async ({ prompt }) => {
      receivedPrompt = prompt;
      return "---SUBJECT---\nUpdated plan\n---NAME---\nPlan update\n---HTML---\n```html\n<p>Attached</p>\n```";
    },
  );

  assert.match(receivedPrompt, /https:\/\/blob\.test\/plan\.pdf/);
  assert.doesNotMatch(receivedPrompt, /javascript:/);
  assert.match(result.html, /<p>Attached<\/p>/);
  assert.equal(result.subject, "Updated plan");
  assert.equal(result.name, "Plan update");
});

test("email template generation is internal-only", async () => {
  await assert.rejects(
    generateEmailTemplate(
      customerPrincipal(),
      {
        attachments: [],
        description: "Hello",
        links: [],
        systemInstruction: "system",
      },
      async () => "ignored",
    ),
  );
  assert.equal(isSafeEmailTemplateUrl("mailto:client@example.com"), false);
});
