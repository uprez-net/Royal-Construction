import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Once DocuSign has accepted an envelope, a failure to record it threw an error
// carrying the envelope id and "Do not resend". Next replaces a Server Action's
// thrown message with a generic one in production, so the estimator saw none of
// that and could send the document again. Those failures now come back as the
// action's { ok: false, error }. No pure seam reaches these paths, so the source
// is pinned.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const SENDS = [
  {
    file: "lib/data/offer-accept-sign.ts",
    envelope: "envelope = await createOfferAcceptanceEnvelope(",
    action: "sendOfferForSignature({ offerId })",
    showsError: "setOfferSignError(result.error)",
    sentStatus: "OfferStatus.OFFER_SENT",
    committedStatusHandler: `if (result.status === OfferStatus.OFFER_SENT) {
            setStatus("offer_sent");
          }`,
  },
  {
    file: "lib/data/offer-tender-sign.ts",
    envelope: "envelope = await createTenderEnvelope(",
    action: "sendTenderForSignature({ offerId })",
    showsError: "setTenderSendError(result.error)",
    sentStatus: "OfferStatus.TENDER_SENT",
    committedStatusHandler: `if (result.status === OfferStatus.TENDER_SENT) {
            setStatus("tender_sent");
          }`,
  },
  {
    file: "lib/data/offer-contract-sign.ts",
    envelope: "envelope = await createContractEnvelope(",
    action: "sendContractForSignature({ offerId })",
    showsError: "setContractSendError(result.error)",
    sentStatus: "OfferStatus.CONTRACT_SENT",
    committedStatusHandler: `if (result.status === OfferStatus.CONTRACT_SENT) {
            setContractTerms(null);
            setStatus("contract_sent");
          }`,
  },
] as const;

// From the envelope's creation to the end of the send function, with comments
// stripped: the claim-before-write block explains that "only a throw rolls
// back" a transaction, and prose about throwing is not a throw.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function afterEnvelope(source: string, envelope: string): string {
  const start = source.indexOf(envelope);
  assert.ok(start >= 0, `no ${envelope}`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `no end of the function holding ${envelope}`);
  return stripComments(source.slice(start, end));
}

for (const send of SENDS) {
  test(`${send.file} returns, never throws, once the envelope exists`, () => {
    const body = afterEnvelope(read(send.file), send.envelope);

    assert.doesNotMatch(body, /\bthrow\s/);
    assert.match(body, /error: `[^`]*Do not resend/);
    assert.match(body, new RegExp(`status: ${send.sentStatus}`));
    assert.match(body, /revalidateTag\(`offer-\$\{offer\.id\}`/);
    assert.match(body, /await syncLeadStageForOffer\(offer\.id\)/);
    // The operator log line stays.
    assert.match(body, /sent but persisting it failed:/);
  });

  test(`the workspace shows ${send.action.split("(")[0]}'s refusal`, () => {
    const workspace = read(
      "components/offers/new-workflow/new-offer-workspace.tsx",
    );
    const start = workspace.indexOf(`const result = await ${send.action};`);
    assert.ok(start >= 0, `the workspace never calls ${send.action}`);
    const handling = workspace.slice(
      start,
      workspace.indexOf("} catch", start),
    );

    assert.ok(
      handling.includes(send.showsError),
      `${send.action} does not show result.error: ${handling}`,
    );
    assert.ok(
      handling.includes(send.committedStatusHandler),
      `${send.action} does not show its committed status`,
    );
  });
}
