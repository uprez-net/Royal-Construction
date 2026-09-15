import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The recall rules are tested in offer-recall.test.ts, but three of the bugs they
// fix lived in how lib/data/offer-workspace.ts used them, and that file is "use
// server" and loads Prisma, so no test can import it. Undoing any one of these
// kept every rule test green:
// - the void query matched only SENT, so an envelope the customer had opened
//   (DELIVERED) was never voided;
// - recallOfferEnvelope passed the client's scope to the void, so a hand-built
//   call could void every envelope on the offer, or in the database;
// - an unconfirmed void was a warning, and the offer moved to draft (or forked a
//   revision) while the customer could still sign.
// A refusal must also be returned rather than thrown, because Next replaces a
// thrown Server Action message with a generic one in production.

const text = readFileSync(
  join(process.cwd(), "lib/data/offer-workspace.ts"),
  "utf8",
);

// A top-level function runs from its signature to the first unindented `}`.
function functionBody(name: string): string {
  const start = text.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in offer-workspace.ts`);
  const end = text.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} has no end`);
  return text.slice(start, end);
}

function indexIn(body: string, needle: string): number {
  const index = body.indexOf(needle);
  assert.ok(index >= 0, `expected ${needle} in the function`);
  return index;
}

const LIVE_FILTER = /status:\s*\{\s*in:\s*LIVE_ENVELOPE_STATUSES\s*\}/;

test("the void and the revision's live check include opened envelopes", () => {
  assert.doesNotMatch(text, /status:\s*EnvelopeStatus\.SENT\b/);
  assert.match(functionBody("voidLiveOfferEnvelopes"), LIVE_FILTER);
  assert.match(functionBody("createOfferRevision"), LIVE_FILTER);
});

test("a recall checks the client's scope before voiding, and voids only its own scope", () => {
  const body = functionBody("recallOfferEnvelope");
  assert.ok(
    indexIn(body, "resolveRecall(") < indexIn(body, "voidLiveOfferEnvelopes("),
    "the recall voids before it has checked the scope",
  );
  const voidCall = body.slice(
    body.indexOf("voidLiveOfferEnvelopes("),
    body.indexOf(");", body.indexOf("voidLiveOfferEnvelopes(")),
  );
  assert.match(voidCall, /\brecall\.scope\b/);
  assert.doesNotMatch(voidCall, /\binput\.scope\b/);
});

test("recall and revision stop before any change unless every void is confirmed", () => {
  const refusal =
    /if \(!decideRecallPullBack\(voids\)\.proceed\) \{\s*return \{\s*ok: false,/;
  const recall = functionBody("recallOfferEnvelope");
  assert.match(recall, refusal);
  assert.ok(
    indexIn(recall, "decideRecallPullBack(voids)") <
      indexIn(recall, "commitOfferTransition("),
    "the recall moves the status before checking the voids",
  );

  const revision = functionBody("createOfferRevision");
  assert.match(revision, refusal);
  assert.ok(
    indexIn(revision, "decideRecallPullBack(voids)") <
      indexIn(revision, "prisma.$transaction("),
    "the revision forks before checking the voids",
  );

  assert.doesNotMatch(text, /voidWarnings\.push/);
});

test("recall and revision return their refusals instead of throwing them", () => {
  for (const name of ["recallOfferEnvelope", "createOfferRevision"]) {
    const body = functionBody(name);
    assert.doesNotMatch(
      body,
      /throw new Error\(\s*(?:describeUnconfirmedVoid|recall\.error|"No revision was created)/,
      `${name} throws a refusal the estimator would never see`,
    );
  }
});

test("a refused void is read back from DocuSign before it is reported", () => {
  const body = functionBody("settleLiveEnvelope");
  assert.ok(
    indexIn(body, "voidEnvelope(") < indexIn(body, "getEnvelopeStatus("),
    "the status is read back before the void is attempted",
  );
  assert.match(body, /readRefusedVoid\(/);
});
