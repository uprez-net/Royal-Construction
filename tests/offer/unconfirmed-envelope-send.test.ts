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

// ── Every send path records the row ──

test("all three send paths record an UnconfirmedEnvelopeSend on outcome-unknown", () => {
  const paths: [string, string][] = [
    ["lib/data/offer-tender-sign.ts", "TENDER"],
    ["lib/data/offer-contract-sign.ts", "CONTRACT"],
    ["lib/data/offer-accept-sign.ts", "OFFER"],
  ];

  for (const [file, docType] of paths) {
    const source = code(file);
    assert.match(
      source,
      /recovery\.kind === "outcome-unknown"/,
      `${file} lost its outcome-unknown branch`,
    );
    // Scoped to the outcome-unknown branch: it is the last branch in each
    // file's if/else if/else chain, so everything from the match to the next
    // top-level `} else {` (or end of file) belongs to it.
    const branchStart = source.indexOf('recovery.kind === "outcome-unknown"');
    const branchEnd = source.indexOf("\n    } else {", branchStart);
    assert.ok(
      branchEnd > branchStart,
      `${file}: could not delimit the outcome-unknown branch — without this the slice runs to end of file and the assertions below could pass on unrelated code`,
    );
    const branch = source.slice(branchStart, branchEnd);

    assert.match(
      branch,
      /prisma\.unconfirmedEnvelopeSend\s*\.create\(/,
      `${file} does not record an UnconfirmedEnvelopeSend row when the outcome is unknown`,
    );
    assert.match(
      branch,
      new RegExp(`docType:\\s*EnvelopeDocType\\.${docType}\\b`),
      `${file} records the wrong docType, or none`,
    );
    assert.match(
      branch,
      /sendAttemptId,/,
      `${file} does not key the row by the send attempt`,
    );
    assert.match(
      branch,
      /attemptStartedAt:\s*attemptStarted,/,
      `${file} does not record when the attempt started`,
    );
    // A DB write here must not crash the response to the operator — the
    // offerStatusEvent write right above it already follows this pattern.
    assert.match(
      branch,
      /prisma\.unconfirmedEnvelopeSend\s*\.create\([\s\S]*?\.catch\(/,
      `${file}'s write is not guarded — a DB hiccup here would crash the outcome-unknown response`,
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

test("the reconcile cron checks the CRON_SECRET in production", () => {
  const source = code(CRON);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /NODE_ENV === "production"/);
});

test("the reconcile cron never sets resolvedAt for a row it found", () => {
  // This is the whole safety property: a found orphan must keep blocking
  // recall until a human deals with it. Only the not-found branch may resolve.
  const source = code(CRON);
  const foundBranchStart = source.indexOf("found += 1;");
  assert.ok(foundBranchStart > 0, "the found branch moved or was renamed");
  const foundBranch = source.slice(foundBranchStart, foundBranchStart + 1200);

  assert.ok(
    !/data:\s*\{[^}]*\bresolvedAt\b/.test(foundBranch),
    "the found branch sets resolvedAt — a real live envelope would stop blocking recall",
  );
  assert.match(
    foundBranch,
    /foundDocusignId:\s*envelopeId/,
    "a found envelope is not recorded for a human to see",
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

test("both write paths guard on the row still being unresolved and unfound", () => {
  // Read-then-write across a whole cron run: a concurrent run, or a person,
  // may have changed the row in between.
  const source = code(CRON);
  const guards = source.match(
    /where:\s*\{\s*id:\s*row\.id,\s*resolvedAt:\s*null,\s*foundDocusignId:\s*null\s*\}/g,
  );
  assert.equal(
    guards?.length,
    2,
    "expected the guard on both the not-found resolve and the found mark",
  );
});

test("the reconcile cron resolves a genuinely not-found row", () => {
  const source = code(CRON);
  assert.match(
    source,
    /envelopeId === null[\s\S]{0,300}resolvedAt:\s*new Date\(\)/,
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
