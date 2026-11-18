import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

test("a document's passages are deleted with it by the database, not only by the nightly sweep", () => {
  // The in-memory database in the other document-index tests cannot cascade,
  // so pin the promise where it lives: deleting a File or an offer reply must
  // delete its passages, and their vectors with them, at once. Without it a
  // deleted document would keep answering the agent until the next nightly run.
  const schema = readFileSync(join(REPO_ROOT, "prisma/schema.prisma"), "utf8");
  // Comments are dropped first: a relation that is only mentioned in one, or
  // commented out, is not a declaration and must not satisfy the check.
  const model = (schema.match(/model AgentFileChunk \{[\s\S]*?\n\}/)?.[0] ?? "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.notEqual(model, "", "the AgentFileChunk model is in the schema");
  assert.match(
    model,
    /file\s+File\?\s+@relation\(fields: \[fileId\], references: \[id\], onDelete: Cascade\)/,
  );
  assert.match(
    model,
    /offerReply\s+OfferDocumentReply\?\s+@relation\(fields: \[offerReplyId\], references: \[id\], onDelete: Cascade\)/,
  );
});
