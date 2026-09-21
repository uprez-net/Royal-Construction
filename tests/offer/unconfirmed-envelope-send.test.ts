import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// #321: the receiving half of an ambiguous DocuSign send (PR #320) refuses a
// recall when it sees an UnconfirmedEnvelopeSend row with resolvedAt null —
// but nothing wrote that row, so the protection never fired. These tests
// check the writing half exists on every path that can produce that state,
// and that the query reading it back cannot silently miss one.
//
// These are source-contract tests, not integration tests — this repo has no
// DB test infrastructure (pure-function tests only), and writing to a real
// UnconfirmedEnvelopeSend row from a test would need one.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ── Every send path records the attempt BEFORE it sends ──

const SEND_PATHS: [string, string, string][] = [
  ["lib/data/offer-tender-sign.ts", "TENDER", "createTenderEnvelope"],
  ["lib/data/offer-contract-sign.ts", "CONTRACT", "createContractEnvelope"],
  ["lib/data/offer-accept-sign.ts", "OFFER", "createOfferAcceptanceEnvelope"],
];

test("all three send paths record the attempt before calling DocuSign", () => {
  // Order is the whole safety property. Recorded afterwards — in the catch,
  // once the outcome is already unknown — a failed write left nothing blocking
  // a recall, so a resend could put a second live document in front of the
  // customer. Writing first also covers what no catch block can: the process
  // dying mid-send.
  for (const [file, docType, createFn] of SEND_PATHS) {
    const source = code(file);
    const begin = source.indexOf("beginEnvelopeSendAttempt({");
    const send = source.indexOf(`${createFn}(`);

    assert.ok(begin > 0, `${file} does not record the send attempt at all`);
    assert.ok(send > 0, `${file}: ${createFn} moved or was renamed`);
    assert.ok(
      begin < send,
      `${file} records the attempt after calling DocuSign — the protection can fail open`,
    );
    assert.match(
      source.slice(begin, send),
      new RegExp(`docType:\\s*EnvelopeDocType\\.${docType}\\b`),
      `${file} records the wrong docType, or none`,
    );
  }
});

test("a send is refused outright when the attempt cannot be recorded", () => {
  // Fail closed. Refusing a send is recoverable; sending with nothing to block
  // a later recall is not.
  for (const [file] of SEND_PATHS) {
    const source = code(file);
    assert.match(
      source,
      /if \(sendAttemptRecordId === null\) \{[\s\S]{0,500}ok: false/,
      `${file} sends anyway when the attempt could not be recorded`,
    );
    // And it must hand the claim back, or the offer sits at *_SENT forever
    // having never sent anything.
    assert.match(
      source,
      /if \(sendAttemptRecordId === null\) \{[\s\S]{0,400}prisma\.offer\.updateMany\(/,
      `${file} leaves the offer claimed after refusing to send`,
    );
  }
});

test("every definitive outcome resolves the attempt, and only the unknown one does not", () => {
  for (const [file] of SEND_PATHS) {
    const source = code(file);

    // reconciled: the envelope exists, but nothing records it yet. Settling
    // here would leave a real live envelope unblocked if the success
    // transaction below then failed — the success path settles it atomically
    // with the Envelope row instead.
    const reconciled = source.indexOf('recovery.kind === "reconciled"');
    const unknown = source.indexOf('recovery.kind === "outcome-unknown"');
    assert.ok(
      reconciled > 0 && unknown > reconciled,
      `${file}: branch order changed`,
    );
    assert.ok(
      !/resolveEnvelopeSendAttempt\(/.test(source.slice(reconciled, unknown)),
      `${file} settles the attempt on reconcile, before the Envelope row that replaces it commits`,
    );

    // outcome-unknown: must NOT resolve — staying unresolved is what blocks.
    const unknownEnd = source.indexOf("\n    } else {", unknown);
    assert.ok(
      unknownEnd > unknown,
      `${file}: could not delimit the unknown branch`,
    );
    assert.ok(
      !/resolveEnvelopeSendAttempt\(/.test(source.slice(unknown, unknownEnd)),
      `${file} settles the attempt when the outcome is unknown — nothing would block a recall`,
    );

    // rejected: DocuSign refused, nothing is out there.
    assert.match(
      source.slice(unknownEnd),
      /resolveEnvelopeSendAttempt\(sendAttemptRecordId\)/,
      `${file} leaves a rejected send blocking a recall forever`,
    );

    // success: resolved in the same transaction as the Envelope row.
    assert.match(
      source,
      /resolveEnvelopeSendAttempt\(sendAttemptRecordId,\s*tx\);\s*await tx\.envelope\.create\(/,
      `${file} does not settle the attempt in the same transaction that writes the Envelope row`,
    );
  }
});

// ── The audit event uses the offer's real status ──

test("the outcome-unknown audit event reads fromStatus off the offer, not a literal", () => {
  // A regression within a regression: this was reported fixed once already
  // and the fix never actually landed. Verified against the literal absence
  // of the old hardcoded values, not just the presence of the new ones.
  const tender = code("lib/data/offer-tender-sign.ts");
  assert.ok(
    !/fromStatus:\s*OfferStatus\.TENDER_DRAFT,/.test(tender),
    "offer-tender-sign.ts still hardcodes TENDER_DRAFT — a direct send from AGREED records a transition that never happened",
  );

  const accept = code("lib/data/offer-accept-sign.ts");
  assert.ok(
    !/fromStatus:\s*OfferStatus\.SENT,/.test(accept),
    "offer-accept-sign.ts still hardcodes SENT",
  );
});

// ── voidLiveOfferEnvelopes reads the rows back ──

test("voidLiveOfferEnvelopes queries unconfirmedEnvelopeSend and blocks on any unresolved row", () => {
  const source = code("lib/data/offer-workspace.ts");

  assert.match(
    source,
    /prisma\.unconfirmedEnvelopeSend\.findMany\(/,
    "the recall/revision path no longer reads the unconfirmed-send table",
  );
  assert.match(
    source,
    /docType:\s*\{\s*in:\s*unconfirmedSendDocTypesForScope\(scope\)\s*\}/,
    "the query is not scoped the same way envelopeScopeFilter scopes Envelope",
  );
  assert.match(
    source,
    /resolvedAt:\s*null/,
    "the query is not filtered to unresolved rows",
  );
  assert.match(
    source,
    /reason:\s*"unconfirmed-send"/,
    "an unresolved row is not added to the unsettled list",
  );
});

test("the dead Envelope-null-and-sentAt check is gone, not left beside the real one", () => {
  // That check could never fire: every Envelope row is written with its
  // docusignId already known, in the same create call, so a live row with
  // docusignId null and sentAt set never occurred. Leaving both in place
  // would read as two mechanisms when only one is real.
  const source = code("lib/data/offer-workspace.ts");
  assert.ok(
    !/env\.docusignId === null && env\.sentAt !== null/.test(source),
    "the unreachable Envelope-based check is back",
  );
});

// ── The reconcile cron ──

const CRON = "app/api/cron/reconcile-unconfirmed-envelope-sends/route.ts";

/**
 * The found-envelope branch of the cron, delimited rather than taken as a
 * fixed number of characters from a nearby line. Anchoring on a counter meant
 * that moving the counter silently moved the window off the code under test.
 */
const foundBranchOf = (source: string): string => {
  const start = source.indexOf("const recorded = await prisma.$transaction(");
  const end = source.indexOf("} catch (recordError)", start);
  assert.ok(start > 0, "the found-envelope transaction moved or was renamed");
  assert.ok(end > start, "could not delimit the found-envelope branch");
  return source.slice(start, end);
};

test("the reconcile cron checks the CRON_SECRET in production", () => {
  const source = code(CRON);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /NODE_ENV === "production"/);
});

test("the reconcile cron never sets resolvedAt for a row it found", () => {
  // This is the whole safety property: a found orphan must keep blocking
  // recall until a human deals with it. Only the not-found branch may resolve.
  const source = code(CRON);
  const foundBranch = foundBranchOf(source);

  // It may only ever write `resolvedAt: null` — clearing it. Stamping a date
  // there would mark a live orphan resolved and stop blocking recall.
  assert.ok(
    !/resolvedAt:\s*new Date\(\)/.test(foundBranch),
    "the found branch resolves the row — a real live envelope would stop blocking recall",
  );
  assert.match(
    foundBranch,
    /foundDocusignId:\s*envelopeId/,
    "a found envelope is not recorded for a human to see",
  );
});

test("a found envelope overrides a concurrent run that found nothing", () => {
  // Two overlapping runs can read the same row and get different answers from
  // DocuSign — different listStatusChanges windows, pagination, a transient
  // blank. If the empty answer resolved the row first and the found path still
  // required resolvedAt to be null, the answer that matters would be dropped
  // and a live orphan left unblocked. So the found write is guarded only on
  // foundDocusignId (which keeps it idempotent) and clears resolvedAt.
  const source = code(CRON);
  const foundBranch = foundBranchOf(source);

  assert.match(
    foundBranch,
    /where:\s*\{\s*id:\s*row\.id,\s*foundDocusignId:\s*null\s*\}/,
    "the found write is guarded on resolvedAt, so a concurrent not-found resolve would silently win",
  );
  assert.match(
    foundBranch,
    /data:\s*\{[^}]*resolvedAt:\s*null/,
    "the found write does not re-open a row a concurrent run just resolved",
  );
});

test("the reconcile cron never re-searches a row it already found an envelope for", () => {
  // Not just wasted DocuSign calls. A later search returning empty — the
  // envelope voided and fell outside the listStatusChanges window, a
  // paginated response, a transient blank — would drop the row into the
  // not-found branch and resolve it, unblocking a recall on an offer that
  // really does have a live orphan envelope.
  const source = code(CRON);
  const queryStart = source.indexOf("unconfirmedEnvelopeSend.findMany(");
  assert.ok(queryStart > 0, "the pending query moved or was renamed");
  const query = source.slice(queryStart, source.indexOf("});", queryStart));

  assert.match(
    query,
    /foundDocusignId:\s*null/,
    "rows with a found envelope are still being re-searched",
  );
});

test("the reconcile cron bounds its batch and takes the oldest first", () => {
  const source = code(CRON);
  assert.match(
    source,
    /take:\s*RECONCILE_BATCH_LIMIT/,
    "the batch is unbounded",
  );
  assert.match(
    source,
    /orderBy:\s*\{\s*attemptStartedAt:\s*"asc"\s*\}/,
    "the batch is not oldest-first, so a backlog can starve newer rows",
  );
});

test("marking a row found and alerting a human are one transaction", () => {
  // Two separate writes would let the mark succeed and the note fail — and
  // since the query skips found rows, the alert would never be retried. The
  // row would block a recall with nothing anywhere saying why.
  const source = code(CRON);
  assert.match(
    source,
    /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?tx\.unconfirmedEnvelopeSend\.updateMany\([\s\S]*?tx\.offerStatusEvent\.create\(/,
    "the found-envelope mark and its activity note are not atomic",
  );
});

test("the not-found resolve cannot clobber a row a concurrent run found", () => {
  // Read-then-write across a whole cron run: a concurrent run, or a person,
  // may have changed the row in between. The not-found path is the dangerous
  // direction, so it carries the full guard — resolving a row that has since
  // been found would unblock a recall on a live orphan.
  const source = code(CRON);
  assert.match(
    source,
    /where:\s*\{\s*id:\s*row\.id,\s*resolvedAt:\s*null,\s*foundDocusignId:\s*null\s*\}/,
    "the not-found resolve is not guarded against a concurrent find",
  );
  assert.match(
    source,
    /updateMany\(/,
    "a guarded conditional write needs updateMany, not update by id",
  );
});

test("a failure anywhere in the run returns a named error, not a bare 500", () => {
  // The pending-row read used to sit outside any try/catch, so a DB failure
  // escaped as an unhandled rejection — a bare 500 with nothing naming the
  // cron, on the one job whose purpose is being noticed when something is off.
  const source = code(CRON);
  assert.match(
    source,
    /try \{[\s\S]*prisma\.unconfirmedEnvelopeSend\.findMany\(/,
    "the pending-row read is outside the error boundary",
  );
  assert.match(
    source,
    /catch \(error\) \{[\s\S]{0,300}errorResponse\(\s*"Failed to reconcile unconfirmed envelope sends"/,
    "a failed run does not report itself with a cron-specific message",
  );
});

test("the reconcile cron resolves a genuinely not-found row", () => {
  const source = code(CRON);
  assert.match(
    source,
    /search\.kind === "not-found"[\s\S]{0,600}resolvedAt:\s*new Date\(\)/,
    "a row that DocuSign has no record of is never marked resolved, so it blocks forever",
  );
});

test("the reconcile cron is registered in vercel.json", () => {
  const vercelJson = JSON.parse(read("vercel.json"));
  const found = vercelJson.crons.some(
    (c: { path: string }) =>
      c.path === "/api/cron/reconcile-unconfirmed-envelope-sends",
  );
  assert.ok(found, "the cron is not wired up to actually run");
});

// ── The migration matches the schema ──

test("a migration creates the table the schema declares", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model UnconfirmedEnvelopeSend \{/);
  assert.match(schema, /sendAttemptId String @unique/);
  assert.match(schema, /resolvedAt\s+DateTime\?/);
});

// ── A partial search must never read as "no envelope" ──

test("an incomplete search never resolves the row", () => {
  // listStatusChanges is paginated. Reading one page and reporting nothing
  // found is a false negative — and the not-found branch is the only path
  // that resolves a row without a human, so a false negative there unblocks a
  // recall for an envelope sitting on a page nobody read.
  const source = code(CRON);
  const incomplete = source.indexOf('search.kind === "incomplete"');
  assert.ok(incomplete > 0, "the cron does not handle an incomplete search");

  const notFound = source.indexOf('search.kind === "not-found"');
  assert.ok(
    notFound > incomplete,
    "the incomplete case must be handled before the not-found case",
  );
  // The incomplete branch must bail out, not fall through to the resolve.
  assert.match(
    source.slice(incomplete, notFound),
    /continue;/,
    "an incomplete search falls through to the not-found resolve",
  );
});

test("the search reports incomplete rather than guessing when it cannot finish", () => {
  const source = code("lib/docusign/envelope-send-attempt.ts");
  assert.match(
    source,
    /kind:\s*"incomplete"/,
    "the search cannot express an unfinished result, so a partial read looks like an empty one",
  );
  // Every stop must be at a proven end of the result set.
  assert.match(
    source,
    /startPosition >= total/,
    "the search does not compare its position against totalSetSize",
  );
  assert.match(
    source,
    /returned < SEARCH_PAGE_SIZE/,
    "with no totalSetSize a full page would be treated as the last page",
  );
});

test("a run with failed rows does not report success", () => {
  // A cron that searched nothing successfully must not read as healthy.
  const source = code(CRON);
  assert.match(source, /failed \+= 1/, "per-row failures are not counted");
  assert.match(
    source,
    /if \(failed > 0\)[\s\S]{0,400}errorResponse\(/,
    "a run with failures still returns a success response",
  );
});

test("an empty page is only the end when the metadata says so", () => {
  // DocuSign can return an empty page while totalSetSize still says more is
  // coming. Calling that "not-found" resolves the attempt and unblocks a
  // recall with a matching envelope still further down the result set.
  const source = code("lib/docusign/envelope-send-attempt.ts");
  assert.match(
    source,
    /if \(returned === 0\) \{[\s\S]{0,400}Number\.isFinite\(total\) && startPosition < total[\s\S]{0,200}kind:\s*"incomplete"/,
    "an empty page short-circuits to not-found without checking the total",
  );
});

test("a database failure counts as a failed row, not a quiet log line", () => {
  // The row is still unresolved either way, so a run that could not persist
  // its decisions must not report success.
  const source = code(CRON);
  const failedIncrements = (source.match(/failed \+= 1/g) ?? []).length;
  assert.equal(
    failedIncrements,
    3,
    "expected the search failure, the not-found update failure and the found-envelope transaction failure all to count",
  );
});
