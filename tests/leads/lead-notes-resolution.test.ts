import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { resolveLeadNotesText, resolveLeadNotesTextOr } from "../../lib/leads/notes-text";
import { createLeadNotesDocument } from "../../lib/rich-text/lead-notes";

// `Lead.notes` stopped being the answer without its readers being told. The
// Notes tab clears the column and the document on save because a note's home is
// its history entry, and the consultation booking route used to write its own
// agenda into the same column. The offer pre-fill, the dashboard, the agent
// prompt and the email templates all read it as the sales notes.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("the column wins when it holds something", () => {
  assert.equal(
    resolveLeadNotesText({
      notes: "Knockdown rebuild with a granny flat.",
      history: [{ action: "Lead note saved", detail: "older note" }],
    }),
    "Knockdown rebuild with a granny flat.",
  );
});

test("a blank column falls through to the document", () => {
  assert.equal(
    resolveLeadNotesText({
      notes: "   ",
      notesDoc: createLeadNotesDocument({ plainText: "Wants slab before March." }),
    }),
    "Wants slab before March.",
  );
});

test("an empty document falls through to the note history", () => {
  // Exactly the shape the composer leaves behind: null column, empty document.
  assert.equal(
    resolveLeadNotesText({
      notes: null,
      notesDoc: createLeadNotesDocument({ plainText: "" }),
      history: [
        { action: "Lead created", detail: "Lead manually created" },
        { action: "Lead note saved", detail: "Discovery call: 2-bed granny flat." },
      ],
    }),
    "Discovery call: 2-bed granny flat.",
  );
});

test("system events are not mistaken for notes", () => {
  assert.equal(
    resolveLeadNotesText({
      notes: null,
      history: [
        { action: "Lead created", detail: "Lead manually created" },
        { action: "Stage changed", detail: "Discovery → Qualified" },
        { action: "Email sent", detail: "Subject: Following up" },
      ],
    }),
    "",
  );
});

test("the booking agenda is readable as a note", () => {
  assert.equal(
    resolveLeadNotesText({
      notes: null,
      history: [{ action: "NOTE", detail: "550sqm block. Hebel facade preferred." }],
    }),
    "550sqm block. Hebel facade preferred.",
  );
});

test("several notes read forwards, most recent kept", () => {
  const history = [
    { action: "Lead note saved", detail: "one" },
    { action: "Lead note saved", detail: "two" },
    { action: "Lead note saved", detail: "three" },
  ];

  assert.equal(
    resolveLeadNotesText({ notes: null, history }, { maxHistoryEntries: 2 }),
    "two\n\nthree",
  );
});

test("a lead with nothing resolves to empty, and the fallback covers it", () => {
  assert.equal(resolveLeadNotesText({ notes: null }), "");
  assert.equal(resolveLeadNotesText(null), "");
  assert.equal(
    resolveLeadNotesTextOr({ notes: null }, "No additional details"),
    "No additional details",
  );
});

test("a caller that loaded no history still gets the column", () => {
  assert.equal(resolveLeadNotesText({ notes: "From the column" }), "From the column");
});

test("a malformed notesDoc does not throw", () => {
  assert.equal(resolveLeadNotesText({ notes: null, notesDoc: { nope: true } }), "");
  assert.equal(resolveLeadNotesText({ notes: null, notesDoc: "not a document" }), "");
});

// ── The readers ──

test("every Lead.notes reader goes through the resolver", () => {
  const readers: [string, string][] = [
    ["lib/data/offer-prefill.ts", "resolveLeadNotesText(lead)"],
    ["lib/data/dashboard.ts", "resolveLeadNotesTextOr(lead,"],
    ["lib/agent/project-prompt.ts", "resolveLeadNotesTextOr(lead,"],
    ["lib/leads/render-email-html.tsx", "resolveLeadNotesTextOr("],
    ["lib/leads/lead-helpers.ts", "resolveLeadNotesTextOr(lead,"],
  ];

  for (const [file, call] of readers) {
    assert.ok(read(file).includes(call), `${file} is reading Lead.notes directly`);
  }
});

test("the booking route no longer overwrites the sales notes", () => {
  const source = read("app/api/graph/book-consultant/route.ts");

  assert.ok(
    !source.includes("const updatedNotes ="),
    "the booking agenda is being written over Lead.notes again",
  );
  assert.ok(!/^\s*notes: updatedNotes,$/m.test(source));
});
