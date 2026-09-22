import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(
  join(process.cwd(), "app/api/docusign/connect/route.ts"),
  "utf8",
);

test("a DocuSign console void returns only its matching sent offer to draft", () => {
  assert.match(
    source,
    /EnvelopeStatus\.VOIDED[\s\S]*?returnOfferToDraftOnVoid\(envelope, payload\)/,
  );
  assert.match(source, /voidedStatus: OfferStatus\.SENT/);
  assert.match(source, /voidedStatus: OfferStatus\.TENDER_DRAFT/);
  assert.match(source, /voidedStatus: OfferStatus\.CONTRACT_DRAFT/);
  assert.match(
    source,
    /async function returnOfferToDraftOnVoid[\s\S]*?offerStatus: target\.expectedFromStatus[\s\S]*?data: \{ offerStatus: target\.voidedStatus \}/,
  );
});

test("a console void records its envelope and refreshes the lead projection", () => {
  const start = source.indexOf("async function returnOfferToDraftOnVoid");
  const body = source.slice(start, source.indexOf("// A decline", start));
  assert.match(body, /DocuSign voided envelope \$\{docusignId\}/);
  assert.match(body, /voidedReason/);
  assert.match(body, /await syncLeadStageForOffer\(target\.offerId\)/);
});
