import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

// A campaign rendered ONE preview iframe from `allLeads[0]`, then scraped that
// same document for every recipient. renderEmailHtml bakes the lead's values in
// as React output rather than as {placeholders}, so hydrateVariable could not
// undo it: every recipient was emailed the first lead's budget, stage, source
// and location. The UI promised the opposite directly above the preview.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const CAMPAIGN = "components/leads/modal-ui/email-campaign-modal.tsx";

test("the body is rendered per recipient, inside the send loop", () => {
  const source = read(CAMPAIGN);
  assert.ok(
    /batch\.map\(async \(lead\) => \{[\s\S]*?renderEmailHtml\(\s*selectedTemplate\.category,\s*lead,?\s*\)/.test(
      source,
    ),
    "the body is not rendered from each recipient's own lead",
  );
});

test("no send path scrapes a shared preview iframe", () => {
  const source = read(CAMPAIGN);
  assert.ok(
    !source.includes("emailIframeRef.current?.contentDocument"),
    "a shared iframe is being scraped again — that is the leak",
  );
  assert.ok(
    !/cleanHtml/.test(source),
    "the iframe-scrubbing helpers are back, which implies the scrape is too",
  );
});

test("a multi-recipient preview is read-only, so no edit can be lost", () => {
  // The preview is the editing surface. Re-rendering per recipient means an
  // edit to the one preview cannot survive, so the honest fix is to stop
  // offering the edit rather than discard it silently.
  const source = read(CAMPAIGN);
  assert.ok(
    /editable=\{false\}/.test(source),
    "the campaign preview is editable again",
  );

  const renderer = read("components/leads/render-email.tsx");
  assert.ok(
    /editable \? getEditablePreviewHtml\(previewHtml\) : previewHtml/.test(
      renderer,
    ),
    "getEditablePreviewHtml is applied regardless of `editable`, which is what made a read-only preview editable anyway",
  );
});

test("the single-lead composer stays editable", () => {
  // One recipient, so editing the body is meaningful and must keep working.
  const flow = read("components/leads/modal-ui/email-flow-modal.tsx");
  assert.ok(
    !/editable=\{false\}/.test(flow),
    "the single-send composer lost its editing surface",
  );
});

test("the preview copy no longer promises what it cannot deliver", () => {
  const source = read(CAMPAIGN);
  assert.ok(
    !source.includes("All emails will be\n            personalized per lead"),
    "the old claim is back",
  );
  assert.ok(
    /read-only/.test(source),
    "the copy should say the preview is read-only",
  );
});

test("each sent campaign email is saved on its lead, in Sydney time (#297)", () => {
  const source = read(CAMPAIGN);
  // The entry used to live only in the value the loop returned, so the
  // activity feed, the offer pre-fill and the agent never saw the send.
  assert.ok(
    /updateLead\(\s*lead\.id,\s*\{\s*history:\s*\[historyEntry\],?\s*\}\s*\)/.test(
      source,
    ),
    "a sent campaign email is not persisted as exactly the one new entry",
  );
  assert.ok(
    !/\[\.\.\.lead\.history,\s*historyEntry\][\s\S]*updateLead/.test(source),
    "updateLead must get only the new entry, never the whole history",
  );
  assert.ok(
    /date:\s*sydneyDateOnly\(now\)[\s\S]*?time:\s*sydneyTimeOnly\(now\)/.test(
      source,
    ),
    "the history date and time are not both read as Sydney",
  );
  assert.ok(
    !/toISOString\(\)\.slice\(0, 10\)|toTimeString\(\)/.test(source),
    "a UTC date or browser-local time is back in the campaign entry",
  );
});
