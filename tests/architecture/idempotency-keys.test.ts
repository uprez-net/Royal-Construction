import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  createAttemptKey,
  createAttemptKeys,
  idempotencyHeader,
} from "@/lib/idempotency/attempt-key";

function read(path: string) {
  return readFileSync(path, "utf8");
}

/** A mint that counts, so a reuse and a rotation are distinguishable. */
function countingMint() {
  let issued = 0;
  return () => `key-${++issued}`;
}

// ---------------------------------------------------------------------------
// The rule: a key belongs to an attempt, not to a click.
// ---------------------------------------------------------------------------

test("the same attempt keeps its key, so a double click sends once", () => {
  const keys = createAttemptKey(countingMint());
  // Two clicks before the pending state commits. Both carry key-1, so the
  // outbox sees the second as a replay instead of emailing a consultant twice.
  assert.equal(keys.current(), "key-1");
  assert.equal(keys.current(), "key-1");
});

test("a retry after a failure reuses the key rather than sending again", () => {
  const keys = createAttemptKey(countingMint());
  const first = keys.current();
  // No rotate: the send threw. It may still have been accepted by the
  // provider, so the retry must present the same key and let the outbox refuse
  // it rather than put a second email on the thread.
  assert.equal(keys.current(), first);
});

test("a deliberate later send rotates onto a new key", () => {
  const keys = createAttemptKey(countingMint());
  assert.equal(keys.current(), "key-1");
  keys.rotate();
  // This is the case the derived server-side key got wrong: a second follow-up
  // on the same day bucketed onto the same key and was reported as sent while
  // nothing went out.
  assert.equal(keys.current(), "key-2");
});

test("rotating before anything was minted is harmless", () => {
  const keys = createAttemptKey(countingMint());
  keys.rotate();
  assert.equal(keys.current(), "key-1");
});

test("each target holds its own key", () => {
  const keys = createAttemptKeys(countingMint());
  const invite = keys.current("invite:a@example.com");
  const other = keys.current("invite:b@example.com");
  assert.notEqual(invite, other);
  // A failed invite to the first address must not consume the second's key.
  assert.equal(keys.current("invite:a@example.com"), invite);
  assert.equal(keys.current("invite:b@example.com"), other);
});

test("rotating one target leaves the others alone", () => {
  const keys = createAttemptKeys(countingMint());
  const a = keys.current("a");
  const b = keys.current("b");
  keys.rotate("a");
  assert.notEqual(keys.current("a"), a);
  assert.equal(keys.current("b"), b);
});

// ---------------------------------------------------------------------------
// The header.
// ---------------------------------------------------------------------------

test("a key becomes a header and an absent one becomes nothing", () => {
  assert.deepEqual(idempotencyHeader("abc"), { "Idempotency-Key": "abc" });
  assert.deepEqual(idempotencyHeader(undefined), {});
  assert.deepEqual(idempotencyHeader(null), {});
});

test("a blank key is omitted rather than sent empty", () => {
  // The routes do `headers.get(...) ?? undefined` and the domain trims, so an
  // empty header falls back to the derived key anyway. Not sending it keeps
  // the request honest about having supplied nothing.
  assert.deepEqual(idempotencyHeader("   "), {});
  assert.deepEqual(idempotencyHeader(""), {});
});

test("a key is trimmed to what the domain will compare", () => {
  assert.deepEqual(idempotencyHeader("  abc  "), { "Idempotency-Key": "abc" });
});

// ---------------------------------------------------------------------------
// Every route that reads the header has a caller that sends one.
// ---------------------------------------------------------------------------

/**
 * Routes that read an Idempotency-Key, and the caller that must supply it.
 *
 * The header is only useful if something sends it. Each of these read the
 * header for months while every caller omitted it, so the domain silently used
 * its derived fallback; this pins the pairing so a new send route cannot land
 * with no caller behind it.
 */
const SEND_PATHS: ReadonlyArray<{
  readonly route: string;
  readonly caller: string;
  readonly evidence: RegExp;
}> = [
  {
    caller: "lib/store/slices/projectsSlice.ts",
    evidence:
      /jsonPost\(\{ mode: "OUTREACH", \.\.\.payload \}, idempotencyKey\)/,
    route: "app/api/(data)/projects/[projectId]/compliance/parties/route.ts",
  },
  {
    caller: "lib/store/slices/projectsSlice.ts",
    evidence: /jsonPost\(payload, idempotencyKey\)/,
    route:
      "app/api/(data)/projects/[projectId]/compliance/parties/reply/route.ts",
  },
  {
    caller: "lib/store/slices/projectsSlice.ts",
    evidence: /headers: idempotencyHeader\(idempotencyKey\)/,
    route:
      "app/api/(data)/projects/[projectId]/compliance/alerts/[alertId]/follow-up/route.ts",
  },
  {
    caller: "hooks/use-clerk-management.ts",
    evidence: /"Idempotency-Key": inviteKeys\.current\(`invite:\$\{email\}`\)/,
    route: "app/api/(data)/users/route.ts",
  },
  {
    // Issue #333. The route refuses a send without the header — there is no
    // derived fallback for a message on a customer's phone.
    caller: "lib/leads/whatsapp-service.ts",
    evidence: /\.\.\.idempotencyHeader\(idempotencyKey\)/,
    route: "app/api/(data)/leads/[leadId]/whatsapp/messages/route.ts",
  },
  {
    // A message into a project's WhatsApp group: the same no-fallback rule.
    caller: "lib/projects/whatsapp-service.ts",
    evidence:
      /\$\{base\(projectId\)\}\/messages`,\s*\{[\s\S]*?\.\.\.idempotencyHeader\(idempotencyKey\)/,
    route: "app/api/(data)/projects/[projectId]/whatsapp/messages/route.ts",
  },
  {
    // The email inviting a project's owners into its group.
    caller: "lib/projects/whatsapp-service.ts",
    evidence:
      /\$\{base\(projectId\)\}\/invite`,\s*\{\s*body[\s\S]*?\.\.\.idempotencyHeader\(idempotencyKey\)/,
    route: "app/api/(data)/projects/[projectId]/whatsapp/invite/route.ts",
  },
];

test("the WhatsApp conversation holds one key per message and rotates only after success", () => {
  const modal = read(
    "components/leads/whatsapp/lead-whatsapp-conversation.tsx",
  );
  assert.match(modal, /useIdempotencyKey\(\)/);
  assert.match(
    modal,
    /await sendWhatsAppMessage\(\s*lead\.id,\s*body,\s*sendKey\.current\(\),?\s*\);\s*\n\s*sendKey\.rotate\(\)/,
    "the send key must rotate immediately after a successful send",
  );
  assert.doesNotMatch(
    modal,
    /catch \(sendError\)[\s\S]{0,400}?sendKey\.rotate\(\)/,
    "rotating on a failed send would let a retry message the customer twice",
  );
});

test("every route reading an Idempotency-Key has a caller that sends one", () => {
  for (const { route, caller, evidence } of SEND_PATHS) {
    assert.match(
      read(route),
      /headers\.get\("[Ii]dempotency-[Kk]ey"\)/,
      `${route} is listed as reading an Idempotency-Key but does not`,
    );
    assert.match(
      read(caller),
      evidence,
      `${caller} does not send an Idempotency-Key for ${route}`,
    );
  }
});

test("the compliance send thunks accept a key from the screen", () => {
  const slice = read("lib/store/slices/projectsSlice.ts");
  for (const thunk of [
    "startPartyOutreach",
    "sendPartyReply",
    "sendComplianceFollowUp",
  ]) {
    const declaration = slice.slice(
      slice.indexOf(`export const ${thunk} = createAsyncThunk<`),
    );
    assert.match(
      declaration.slice(0, 400),
      /idempotencyKey\?: string/,
      `${thunk} does not take an idempotency key`,
    );
  }
});

test("the screens hold a key per attempt and rotate it only on success", () => {
  const screens = [
    "components/projects/detail/project-alerts.tsx",
    "components/modals/compliance/connect-party-modal.tsx",
    "components/modals/compliance/party-revision-modal.tsx",
    "components/projects/detail/compliance-tab/project-compliance-tab.tsx",
  ];
  for (const screen of screens) {
    const source = read(screen);
    assert.match(
      source,
      /useIdempotencyKey\(\)/,
      `${screen} does not hold an idempotency key`,
    );
    // The rotate has to sit after the awaited unwrap, never in a catch or a
    // finally: rotating on failure is what would let a retry send twice.
    assert.match(
      source,
      /\.unwrap\(\);\s*\n\s*\w+Key\.rotate\(\)/,
      `${screen} does not rotate its key immediately after a successful send`,
    );
    assert.doesNotMatch(
      source,
      /catch[\s\S]{0,200}?\w+Key\.rotate\(\)/,
      `${screen} rotates its idempotency key on failure`,
    );
  }
});

test("the team screen revoke posts to a route that exists", () => {
  const hook = read("hooks/use-clerk-management.ts");
  // It pointed at /api/invitations, which is not a route in this app — the
  // revoke handler is the DELETE on /api/users — so every revoke 404'd.
  assert.doesNotMatch(hook, /"\/api\/invitations"/);
  assert.match(hook, /"Idempotency-Key": inviteKeys\.current\(`revoke:/);
});

test("the key holder is Node-safe so this test can reach the rule", () => {
  const source = read("lib/idempotency/attempt-key.ts");
  assert.doesNotMatch(source, /from "react"/);
  assert.doesNotMatch(source, /"use client"/);
  assert.doesNotMatch(source, /from "next\//);
});
