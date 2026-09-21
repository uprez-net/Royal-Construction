import type { OfferStatus, Prisma } from "@prisma/client";
import { RECALL_EDGES, type RecallScope } from "./offer-workflow-transitions";

// Recall decisions, kept out of the "use server" module so they can be tested.
// recallOfferEnvelope is a Server Action: every argument it receives comes from
// the client and is checked here before anything is voided.

// Which of an offer's live envelopes to pull back. "all" is for Create revision
// only; a recall always names one document.
export type OfferEnvelopeScope = RecallScope | "all";

export function envelopeScopeFilter(
  offerId: string,
  scope: OfferEnvelopeScope,
): Prisma.EnvelopeWhereInput[] {
  switch (scope) {
    // A live OFFER-acceptance envelope (ADR 0004) hangs off the offer directly.
    case "offer":
      return [{ offerId }];
    case "tender":
      return [{ tender: { offerId } }];
    case "contract":
      return [{ contract: { offerId } }];
    case "all":
      return [{ tender: { offerId } }, { contract: { offerId } }, { offerId }];
    default: {
      // Without this, an unknown scope fell out of the switch as undefined.
      // Prisma drops `OR: undefined`, so the void query matched every live
      // envelope in the database, for every customer.
      const unknownScope: never = scope;
      throw new Error(`Unknown envelope scope: ${String(unknownScope)}`);
    }
  }
}

export type RecallResolution =
  | {
      readonly ok: true;
      readonly scope: RecallScope;
      readonly from: OfferStatus;
      readonly to: OfferStatus;
    }
  | { readonly ok: false; readonly error: string };

// The scope and the target status come from the offer's own status. The
// client's `scope` and `toStatus` are only accepted when they say the same
// thing, so a stale tab or a hand-built request cannot recall a different
// document or land the offer somewhere else.
export function resolveRecall(
  scope: unknown,
  toStatus: unknown,
  currentStatus: OfferStatus,
  isActive: boolean,
): RecallResolution {
  if (!isActive) {
    return {
      ok: false,
      error:
        "This revision has been replaced by a newer one, so there is nothing to recall on it. Open the current revision.",
    };
  }
  const edge = Object.hasOwn(RECALL_EDGES, currentStatus)
    ? RECALL_EDGES[currentStatus]
    : undefined;
  if (edge === undefined) {
    return {
      ok: false,
      error:
        "Nothing on this offer is out for signature, so there is nothing to recall. Refresh to see its current status.",
    };
  }
  if (
    typeof scope !== "string" ||
    scope !== edge.scope ||
    toStatus !== edge.to
  ) {
    return {
      ok: false,
      error:
        "This recall does not match the document that is out for signature. Refresh and try again.",
    };
  }
  return { ok: true, scope: edge.scope, from: currentStatus, to: edge.to };
}

// A live envelope that could not be shown dead, and why. The reason decides the
// advice: voiding by hand in DocuSign only helps one still out for signature.
export type UnsettledEnvelope = {
  readonly id: string;
  // DocuSign's envelope id, which is what the estimator can find in DocuSign.
  // Null only for "unconfirmed-send": there is no id precisely because the
  // create call never came back.
  readonly docusignId: string | null;
  // "still-out": DocuSign refused the void or could not be reached, and does not
  // say the envelope ended, so the customer may still be able to sign it.
  // "signed": DocuSign shows it signed, but the signed copy never reached us.
  // "unrecorded": DocuSign has it voided or declined, but writing that failed.
  // "unconfirmed-send": the create call timed out and reconciliation could not
  // find the envelope, so DocuSign may or may not have sent one. There is no
  // id to look up, which is what makes it different from "still-out".
  readonly reason: "still-out" | "signed" | "unrecorded" | "unconfirmed-send";
};

export type EnvelopeVoidOutcome = {
  // Every envelope in scope that was still live when the pull-back started.
  readonly liveIds: readonly string[];
  // Envelopes this pull-back voided (or that never reached DocuSign).
  readonly voidedIds: readonly string[];
  // Envelopes DocuSign already had voided or declined, now recorded as such.
  readonly endedIds: readonly string[];
  readonly unsettled: readonly UnsettledEnvelope[];
};

// A recall or a revision moves on only when every live envelope in scope is
// confirmed dead: voided now, or already voided or declined in DocuSign. The
// alternative, which this replaced, moved the offer to a draft while DocuSign had
// not voided the envelope, so an estimator edited a document the customer could
// still sign. No live envelopes at all is a clean pull-back: there is nothing a
// customer can sign.
export function decideRecallPullBack(outcome: EnvelopeVoidOutcome): {
  readonly proceed: boolean;
} {
  const dead = new Set([...outcome.voidedIds, ...outcome.endedIds]);
  return {
    proceed:
      outcome.unsettled.length === 0 &&
      outcome.liveIds.every((id) => dead.has(id)),
  };
}

// What the estimator is told when a pull-back is refused. It names the envelopes
// and gives advice that can work for each of them. It must not claim nothing
// changed: an envelope voided before a later one failed stays voided, because
// voiding is final.
export function describeUnconfirmedVoid(input: {
  readonly unsettled: readonly UnsettledEnvelope[];
  readonly voidedCount: number;
  readonly action: "recall" | "revision";
}): string {
  const idsFor = (reason: UnsettledEnvelope["reason"]) =>
    input.unsettled
      .filter((env) => env.reason === reason)
      .map((env) => env.docusignId)
      .filter((id): id is string => id !== null);
  const stillOut = idsFor("still-out");
  const signed = idsFor("signed");
  const unrecorded = idsFor("unrecorded");
  const unconfirmed = input.unsettled.filter(
    (env) => env.reason === "unconfirmed-send",
  );
  const retry =
    input.action === "recall" ? "recall again" : "create the revision again";

  const sentences: string[] = [];
  if (unconfirmed.length > 0) {
    // Deliberately first, and deliberately without an id: this is the case the
    // estimator cannot resolve from inside the app, and the one that produces
    // two live envelopes if they simply try again.
    sentences.push(
      unconfirmed.length === 1
        ? "A send timed out and the app could not confirm whether DocuSign issued the envelope. Open DocuSign and check for an envelope on this offer before sending again — sending now can leave the client with two."
        : `${unconfirmed.length} sends timed out and the app could not confirm whether DocuSign issued the envelopes. Open DocuSign and check this offer before sending again — sending now can leave the client with duplicates.`,
    );
  }
  if (stillOut.length > 0) {
    sentences.push(
      `The document is still out for signature: DocuSign did not confirm the void of ${envelopeNames(stillOut)}.`,
    );
  }
  if (signed.length > 0) {
    sentences.push(
      `DocuSign shows ${envelopeNames(signed)} as signed, but the signed copy never reached the app.`,
    );
  }
  if (unrecorded.length > 0) {
    sentences.push(
      `DocuSign has ${envelopeNames(unrecorded)} voided or declined, but the app could not record that.`,
    );
  }
  if (sentences.length === 0) {
    sentences.push(
      "The document may still be out for signature: DocuSign did not confirm every void.",
    );
  }
  sentences.push(
    input.action === "recall"
      ? "The offer's status was not changed."
      : "No revision was created.",
  );
  if (input.voidedCount === 1) {
    sentences.push("One other envelope was voided and stays voided.");
  } else if (input.voidedCount > 1) {
    sentences.push(
      `${input.voidedCount} other envelopes were voided and stay voided.`,
    );
  }
  if (signed.length > 0) {
    // Voiding a signed envelope is impossible, and retrying changes nothing
    // until DocuSign's completion update is delivered.
    sentences.push(
      "Tell an admin that DocuSign's signing update did not reach the app.",
    );
  }
  if (stillOut.length === 1) {
    sentences.push(
      `Try again in a moment. If that fails too, open the envelope in DocuSign, void it there if it is still out for signature, then ${retry}.`,
    );
  } else if (stillOut.length > 1) {
    sentences.push(
      `Try again in a moment. If that fails too, open the envelopes in DocuSign, void any still out for signature, then ${retry}.`,
    );
  } else if (signed.length === 0) {
    sentences.push("Try again in a moment.");
  }
  return sentences.join(" ");
}

function envelopeNames(ids: readonly string[]): string {
  return ids.length === 1
    ? `envelope ${ids[0]}`
    : `envelopes ${ids.join(", ")}`;
}
