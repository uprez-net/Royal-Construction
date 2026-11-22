import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

import { collectSourceFiles, ROOT, walkGraph } from "./module-graph";

// A refusal the operator cannot read is a refusal that did not happen.
//
// `lib/domain/errors.ts` gives every refusal a `status`, a `code` and a message
// written to be shown to somebody. That only helps if the adapter above it
// passes them on. Most route handlers in this repo were written before the
// taxonomy existed and end in:
//
//     } catch (error) {
//       console.error(...);
//       return errorResponse("Failed to …", { status: 500, code: "INTERNAL_ERROR" });
//     }
//
// which flattens "This variation was already approved.", "You do not have
// access to this project." and "The last admin cannot be demoted." into one
// blank wall. Royal Constructions has two or three people and nobody watching
// logs, so the screen IS the error reporting — and the usual response to a
// blank failure is to press the button again, which is how a double-decided
// variation or a second customer email happens.
//
// So: a handler that can reach a domain command must map a `DomainError` to
// its own status and message, or be listed below with the reason it does not
// yet. The list is the audit. It may shrink; an entry that stops being needed
// fails the last test here so it does not linger as a stale excuse.

const read = (path: string) => readFileSync(path, "utf8");
const repoPath = (file: string) => relative(ROOT, file).split("\\").join("/");

/** Handlers and actions: the modules that answer a browser. */
function adapterEntryPoints(): string[] {
  return [
    ...collectSourceFiles(join(ROOT, "app")).filter((file) =>
      /[\\/]route\.tsx?$/.test(file),
    ),
    ...collectSourceFiles(join(ROOT, "lib", "actions")),
  ].sort();
}

/** Does this adapter's import graph reach a `lib/domain` module? */
function reachesDomain(file: string): boolean {
  let reached = false;
  walkGraph({
    entryFiles: [file],
    forbiddenPackage: () => false,
    forbiddenPath: (path) => {
      // `forbiddenPath` is the walker's "stop here and record it" hook, which
      // is exactly the probe needed: report the first domain module reached
      // and do not walk into the layer.
      if (!path.startsWith("lib/domain/")) return false;
      // The error taxonomy and the response mapper are how an adapter answers
      // a refusal — reaching those is not the same as calling a command.
      if (
        path === "lib/domain/errors.ts"
        || path === "lib/domain/principal.ts"
        || path === "lib/domain/db.ts"
      ) {
        return false;
      }
      reached = true;
      return true;
    },
  });
  return reached;
}

/**
 * Does this adapter pass a domain refusal on?
 *
 * Either through the shared mapper, or by narrowing the error itself — the
 * project PATCH route answers a `ProjectDateBlockerError` with the blocker
 * list bound to form fields, which is worth more than a status code.
 */
function mapsDomainErrors(file: string): boolean {
  const source = read(file);
  return (
    source.includes("domainErrorResponse")
    || source.includes("domainActionFailure")
    || source.includes("isDomainError")
    || source.includes("domainErrorStatus")
    || source.includes("failureFromThrownError")
    || source.includes("ProjectDateBlockerError")
  );
}

/**
 * Does this adapter swallow a throw into a response of its own choosing?
 *
 * A handler with no `catch` lets the error propagate, which Next answers as a
 * 500 — no worse for the operator than a hand-written one, and not something
 * this test can improve by nagging. The ones worth naming are those that catch
 * and then decide what to say.
 */
function catchesAndAnswers(file: string): boolean {
  const source = read(file);
  return (
    /\bcatch\s*\(/.test(source)
    && /Response\(|errorResponse|return \{/.test(source)
  );
}

/**
 * Adapters that reach a domain command, catch its refusal, and answer with
 * something of their own — each with why it has not been mapped yet.
 *
 * Every entry is a real gap, but none of them is a route waiting on a
 * migration any more — the compliance surface that made up the bulk of this
 * list now calls `domainErrorResponse` before its own generic answer. What is
 * left answers something other than a browser, or answers a browser in a shape
 * of its own that already carries the refusal. Each says which.
 */
const LEADS_RESULT_SHAPE =
  "answers with its own {ok,error} result the lead screens already read; the refusal reaches the operator, just not through the shared mapper (worth reconciling when the lead routes are revisited)";
const MACHINE_CALLER =
  "answers a machine, not a screen: a cron, a webhook or a Workflow step. Its failures surface through the outbox and the audit trail, which is where somebody can act on them";
const AGENT_SESSIONS =
  "Eve's own channel, which maps DomainErrorCode rather than an HTTP status (agent/lib/result-contracts.ts)";
const OAUTH_REDIRECT =
  "a browser navigation in an OAuth leg: it answers with a redirect carrying the failure, because a JSON body strands the operator on a blob of JSON with a spent authorization code";
const UPLOAD =
  "answers the Vercel Blob client handshake, whose error shape the browser SDK owns";
const ADMIN_CONTENT =
  "returns its own {ok,error} result that the admin editor renders; worth reconciling with domainActionFailure when the admin surface is revisited";

const UNMAPPED: Record<string, string> = {
  "app/api/(data)/leads/tasks/route.ts": LEADS_RESULT_SHAPE,
  "app/api/(workflow)/extract-checklist/route.ts": MACHINE_CALLER,
  "app/api/(workflow)/extract-project-data/route.ts": MACHINE_CALLER,
  "app/api/(workflow)/resume-stream/[runId]/route.ts": MACHINE_CALLER,
  "app/api/cron/compliance-alerts/route.ts": MACHINE_CALLER,
  "app/api/cron/followup-lead-reminder/route.ts": MACHINE_CALLER,
  "app/api/cron/meeting-review-reminder/route.ts": MACHINE_CALLER,
  "app/api/cron/sync-sent-mail/route.ts": MACHINE_CALLER,
  "app/api/cron/tradie-reminders/route.ts": MACHINE_CALLER,
  "app/api/graph/notifications/route.ts": MACHINE_CALLER,
  "app/api/webhook/clerk/route.ts": MACHINE_CALLER,
  "app/api/xero/notification/route.ts": MACHINE_CALLER,
  "app/api/agent/sessions/[sessionId]/context/route.ts": AGENT_SESSIONS,
  "app/api/docusign/connect/route.ts": OAUTH_REDIRECT,
  "app/api/upload/route.ts": UPLOAD,
  "app/api/xero/connect/route.ts": OAUTH_REDIRECT,
  "lib/actions/admin-offer-content.ts": ADMIN_CONTENT,
};

test("the audit can actually see an adapter reach the domain", () => {
  // A self-check: if the graph probe silently stopped working, every adapter
  // would look clean and this file would pass while asserting nothing.
  const known = join(ROOT, "app", "api", "(data)", "users", "route.ts");
  assert.equal(
    reachesDomain(known),
    true,
    "the probe no longer sees app/api/(data)/users/route.ts reach lib/domain",
  );
  assert.equal(mapsDomainErrors(known), true);
});

test("an adapter that answers a domain refusal says what it was", () => {
  const unmapped: string[] = [];

  for (const file of adapterEntryPoints()) {
    const path = repoPath(file);
    if (path in UNMAPPED) continue;
    if (!reachesDomain(file)) continue;
    if (!catchesAndAnswers(file)) continue;
    if (mapsDomainErrors(file)) continue;
    unmapped.push(path);
  }

  assert.deepEqual(
    unmapped,
    [],
    `These adapters catch a domain refusal and answer with something of their own choosing, so the operator never learns what was refused. Use \`domainErrorResponse\` from lib/http/domain-response.ts (a route) or \`domainActionFailure\` (a Server Action), or add the file to UNMAPPED with the reason:\n\n  ${unmapped.join(
      "\n  ",
    )}\n`,
  );
});

test("the audit list names only adapters that still need it", () => {
  const stale: string[] = [];

  for (const [path, reason] of Object.entries(UNMAPPED)) {
    assert.ok(reason.trim().length > 0, `${path} needs a reason`);
    const file = join(ROOT, path);
    if (!reachesDomain(file) || mapsDomainErrors(file)) {
      stale.push(path);
    }
  }

  assert.deepEqual(
    stale,
    [],
    `These UNMAPPED entries now map their refusals, or no longer reach a domain command. Delete them:\n  ${stale.join(
      "\n  ",
    )}\n`,
  );
});

test("the shared mapper never shows an unexpected error to an operator", () => {
  // A non-domain throw is a bug, and its message can carry a stack, a query or
  // another record's data. It has to fall through to the caller's own 500.
  const mapper = read(join(ROOT, "lib", "http", "domain-response.ts"));
  assert.match(mapper, /if \(!isDomainError\(error\)\) return null;/);
  assert.match(mapper, /if \(!isDomainError\(error\)\) return null;/);
});
