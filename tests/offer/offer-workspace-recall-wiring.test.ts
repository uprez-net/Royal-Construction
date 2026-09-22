import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

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

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const recallSource = read("lib/domain/offers/recall.ts");
const revisionSource = read("lib/domain/offers/revisions.ts");
const controlSource = read("lib/domain/offers/envelope-control.ts");

// A top-level function runs from its signature to the first unindented `}`.
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} has no end`);
  return source.slice(start, end);
}

function indexIn(body: string, needle: string): number {
  const index = body.indexOf(needle);
  assert.ok(index >= 0, `expected ${needle} in the function`);
  return index;
}

const LIVE_FILTER = /status:\s*\{\s*in:\s*LIVE_ENVELOPE_STATUSES\s*\}/;

test("the void and the revision's live check include opened envelopes", () => {
  assert.doesNotMatch(controlSource, /status:\s*EnvelopeStatus\.SENT\b/);
  assert.match(
    functionBody(controlSource, "voidLiveOfferEnvelopes"),
    LIVE_FILTER,
  );
  assert.match(
    functionBody(revisionSource, "createOfferRevision"),
    LIVE_FILTER,
  );
});

test("a recall checks the client's scope before voiding, and voids only its own scope", () => {
  const body = functionBody(recallSource, "recallOfferEnvelope");
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
  const recall = functionBody(recallSource, "recallOfferEnvelope");
  const recallDecision = indexIn(
    recall,
    "if (!decideRecallPullBack(voids).proceed)",
  );
  const recallCommit = indexIn(recall, "commitOfferStatusTransition(");
  assert.match(recall.slice(recallDecision, recallCommit), /ok:\s*false/);
  assert.ok(
    recallDecision < recallCommit,
    "the recall moves the status before checking the voids",
  );

  const revision = functionBody(revisionSource, "createOfferRevision");
  const revisionDecision = indexIn(
    revision,
    "if (!decideRecallPullBack(voids).proceed)",
  );
  const revisionTransaction = indexIn(revision, "db.$transaction(");
  assert.match(
    revision.slice(revisionDecision, revisionTransaction),
    /ok:\s*false/,
  );
  assert.ok(
    revisionDecision < revisionTransaction,
    "the revision forks before checking the voids",
  );

  assert.doesNotMatch(recallSource + revisionSource, /voidWarnings\.push/);
});

test("recall and revision return their refusals instead of throwing them", () => {
  for (const [source, name] of [
    [recallSource, "recallOfferEnvelope"],
    [revisionSource, "createOfferRevision"],
  ] as const) {
    const body = functionBody(source, name);
    assert.doesNotMatch(
      body,
      /throw new Error\(\s*(?:describeUnconfirmedVoid|recall\.error|"No revision was created)/,
      `${name} throws a refusal the estimator would never see`,
    );
  }
});

test("a refused void is read back from DocuSign before it is reported", () => {
  const body = functionBody(controlSource, "settleLiveEnvelope");
  assert.ok(
    indexIn(body, "port.void(") < indexIn(body, "port.getStatus("),
    "the status is read back before the void is attempted",
  );
  assert.match(body, /readRefusedVoid\(/);
});
