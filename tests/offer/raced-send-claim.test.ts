import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// A send claims the offer, creates the DocuSign envelope, then records it. A
// recall or Create revision in that window moves the offer on, and the send's
// own transaction must not write over what it no longer owns: returning from a
// $transaction callback COMMITS (only a throw rolls back), so the claim check
// has to come BEFORE the upsert, not after it. Getting this wrong cleared
// executedPdfUrl on a document that may already be executed — the same loss as
// issue #90, arrived at from the other end.
//
// There is no database in the unit suite (see AGENTS.md), so this asserts the
// order in the source: the mistake is a reordering, and a reordering is exactly
// what this catches.

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// Just the send's own transaction. Slicing to the end of the file let these
// assertions match some later function, so a regression inside the transaction
// could pass on the strength of code that has nothing to do with it.
function sendTransaction(source: string): string {
  const start = source.indexOf("const stillClaimed = await prisma");
  assert.ok(start > -1, "no send transaction found");
  const end = source.indexOf("\n  })", start);
  assert.ok(end > start, "the send transaction has no end");
  return source.slice(start, end);
}

const PATHS = [
  { path: "lib/data/offer-contract-sign.ts", model: "tx.contract.upsert" },
  { path: "lib/data/offer-tender-sign.ts", model: "tx.tender.upsert" },
] as const;

for (const { path, model } of PATHS) {
  test(`${path}: the send claim is checked before the document is written`, () => {
    const transaction = sendTransaction(read(path));
    const claimAt = transaction.indexOf("tx.offer.updateMany");
    const upsertAt = transaction.indexOf(model);
    assert.ok(claimAt > -1, "no claim update found");
    assert.ok(upsertAt > -1, `no ${model} found`);
    assert.ok(
      claimAt < upsertAt,
      `${model} runs before the claim check, so a raced send overwrites the stored document`,
    );
  });

  test(`${path}: a raced send leaves the stored document alone`, () => {
    const transaction = sendTransaction(read(path));
    const upsertAt = transaction.indexOf(model);
    assert.ok(upsertAt > -1, `no ${model} found`);
    const upsert = transaction.slice(upsertAt);
    const update = upsert.slice(0, upsert.indexOf("create:"));
    assert.match(
      update,
      /update: claimed/,
      "the upsert writes regardless of the claim",
    );
    assert.match(
      transaction,
      /if \(!claimed\) \{\s*return false;/,
      "the raced branch does not return before the status event",
    );
  });
}
