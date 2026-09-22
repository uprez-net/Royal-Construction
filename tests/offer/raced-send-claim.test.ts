import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const command = read("lib/domain/offers/envelope-send.ts");

test("the shared envelope command checks its claim before writing a document", () => {
  const start = command.indexOf("export async function persistSentEnvelope");
  const end = command.indexOf("export async function readOfferForSend", start);
  const body = command.slice(start, end);
  const claimAt = body.indexOf("tx.offer.updateMany");
  const documentAt = body.indexOf("input.writeDocument");
  const envelopeAt = body.indexOf("tx.envelope.create");
  assert.ok(claimAt >= 0, "no conditional claim check found");
  assert.ok(
    documentAt > claimAt,
    "the document is written before the claim check",
  );
  assert.ok(
    envelopeAt > documentAt,
    "the envelope is written before its document",
  );
  assert.match(body, /if \(!claimed\) return \{ kind: "raced" as const \};/);
});

for (const { writer, model } of [
  { writer: "writeContractEnvelopeDocument", model: "tx.contract.upsert" },
  { writer: "writeTenderEnvelopeDocument", model: "tx.tender.upsert" },
] as const) {
  test(`${writer}: a raced send leaves the stored document alone`, () => {
    const start = command.indexOf(`export async function ${writer}`);
    const end = command.indexOf("\n}\n", start);
    assert.ok(start >= 0 && end > start, `${writer} not found`);
    const source = command.slice(start, end);
    assert.ok(source.includes(model), `no ${model} document writer found`);
    assert.match(source, /update: input\.claimed\s*\?/);
    assert.match(source, /:\s*\{\}/);
  });
}
