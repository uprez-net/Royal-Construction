import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

// Once DocuSign has accepted an envelope, a failure to record it threw an error
// carrying the envelope id and "Do not resend". Next replaces a Server Action's
// thrown message with a generic one in production, so the estimator saw none of
// that and could send the document again. Those failures now come back as the
// action's { ok: false, error }. No pure seam reaches these paths, so the source
// is pinned.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const sharedPersistence = read("lib/domain/offers/envelope-send.ts");

const SENDS = [
  {
    file: "lib/offer/sends/acceptance-envelope.ts",
    envelope: "envelope = await acceptanceEnvelopePort.send(",
    action: "sendOfferForSignature({ offerId })",
    showsError: "setOfferSignError(result.error)",
    sentStatus: "OfferStatus.OFFER_SENT",
    committedStatusHandler: `if (result.status === OfferStatus.OFFER_SENT) {
            setStatus("offer_sent");
          }`,
  },
  {
    file: "lib/offer/sends/tender-envelope.ts",
    envelope: "envelope = await tenderEnvelopePort.send(",
    action: "sendTenderForSignature({ offerId })",
    showsError: "setTenderSendError(result.error)",
    sentStatus: "OfferStatus.TENDER_SENT",
    committedStatusHandler: `if (result.status === OfferStatus.TENDER_SENT) {
            setStatus("tender_sent");
          }`,
  },
  {
    file: "lib/offer/sends/contract-envelope.ts",
    envelope: "envelope = await contractEnvelopePort.send(",
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

test("the app's send effects expire the offer and sync the lead", () => {
  const effects = read("lib/data/offer-send-effects.ts");
  assert.match(effects, /revalidateTag\(`offer-\$\{offerId\}`/);
  assert.match(effects, /syncLeadStageForOffer\(offerId\)/);
  for (const send of SENDS) {
    const action = read(
      send.action.startsWith("sendOfferForSignature")
        ? "lib/data/offer-accept-sign.ts"
        : send.action.startsWith("sendTender")
          ? "lib/data/offer-tender-sign.ts"
          : "lib/data/offer-contract-sign.ts",
    );
    assert.match(action, /\bappOfferSendEffects,?\s*\)/);
  }
});

for (const send of SENDS) {
  test(`${send.file} returns, never throws, once the envelope exists`, () => {
    const body = afterEnvelope(read(send.file), send.envelope);

    assert.doesNotMatch(body, /\bthrow\s/);
    assert.match(body, /error: `[^`]*Do not resend/);
    // An unrecorded send still committed the claim, so the caller must be
    // told the status it left behind and the screen and lead must follow it.
    assert.match(body, new RegExp(`status: ${send.sentStatus}`));
    // The caller's effects expire the offer and bring the lead along: the
    // app's are lib/data/offer-send-effects.ts, Eve's the lead-stage rule.
    assert.match(body, /effects\.offerChanged\(offer\.id\)/);
    assert.match(body, /await effects\.statusChanged\(offer\.id\)/);
    // The operator log line moved with the persistence rule, and stays shared.
    assert.match(sharedPersistence, /sent but persisting it failed:/);
  });

  // The branch above passes on `unrecorded` alone, which is how this one went
  // unpinned: an unknown outcome keeps the claim and records *_SENT too, so it
  // owes the caller the same status and the same effects (#502).
  test(`${send.file} reports the status an unknown outcome left behind`, () => {
    const source = stripComments(read(send.file));
    const start = source.indexOf('recovery.kind === "outcome-unknown"');
    assert.ok(start >= 0, "no outcome-unknown branch");
    const end = source.indexOf("} else {", start);
    assert.ok(end > start, "no end of the outcome-unknown branch");
    const branch = source.slice(start, end);

    assert.match(branch, new RegExp(`status: ${send.sentStatus}`));
    assert.match(branch, /effects\.offerChanged\(offer\.id\)/);
    assert.match(branch, /await effects\.statusChanged\(offer\.id\)/);
    assert.match(branch, /Do not resend/);
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
