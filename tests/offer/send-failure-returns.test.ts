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
  },
  {
    file: "lib/data/offer-tender-sign.ts",
    envelope: "envelope = await createTenderEnvelope(",
    action: "sendTenderForSignature({ offerId })",
    showsError: "setTenderSendError(result.error)",
  },
  {
    file: "lib/data/offer-contract-sign.ts",
    envelope: "envelope = await createContractEnvelope(",
    action: "sendContractForSignature({ offerId })",
    showsError: "setContractSendError(result.error)",
  },
] as const;

// From the envelope's creation to the end of the send function.
function afterEnvelope(source: string, envelope: string): string {
  const start = source.indexOf(envelope);
  assert.ok(start >= 0, `no ${envelope}`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end);
}

for (const send of SENDS) {
  test(`${send.file} returns, never throws, once the envelope exists`, () => {
    const body = afterEnvelope(read(send.file), send.envelope);

    assert.doesNotMatch(body, /\bthrow\s/);
    assert.match(body, /error: `[^`]*Do not resend/);
    // The operator log line stays.
    assert.match(body, /sent but persisting it failed:/);
  });

  test(`the workspace shows ${send.action.split("(")[0]}'s refusal`, () => {
    const workspace = read("components/offers/new-workflow/new-offer-workspace.tsx");
    const start = workspace.indexOf(`const result = await ${send.action};`);
    assert.ok(start >= 0, `the workspace never calls ${send.action}`);
    const handling = workspace.slice(start, workspace.indexOf("} catch", start));

    assert.ok(
      handling.includes(send.showsError),
      `${send.action} does not show result.error: ${handling}`,
    );
  });
}
