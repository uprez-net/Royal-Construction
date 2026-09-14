import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RUN_CAPABILITY_SECRET_ENV,
  runCapabilitySecret,
  signRunCapability,
  verifyRunCapability,
} from "../../lib/workflow/run-capability";

// /api/resume-stream/<runId> streamed any workflow run to any signed-in user:
// the only check was that a session existed, so a run id was a bearer secret
// with no owner. The extraction routes now hand out a capability bound to the
// user who started the run, and resume-stream accepts nothing else.

const SECRET = "test-secret-not-for-production";
const RUN = "wrun_01K5EXAMPLE0000000000000000";
const ALICE = "5b0f6d2e-4c1a-4e8e-9a51-1f2d3c4b5a60";
const BOB = "9c3e1a7b-2d4f-4b6a-8e1c-0a9b8c7d6e5f";

test("a capability verifies for the user it was issued to and yields the run id", () => {
  const token = signRunCapability({ runId: RUN, userId: ALICE }, SECRET);
  assert.equal(verifyRunCapability(token, ALICE, SECRET), RUN);
});

test("another signed-in user cannot use the capability", () => {
  const token = signRunCapability({ runId: RUN, userId: ALICE }, SECRET);
  assert.equal(verifyRunCapability(token, BOB, SECRET), null);
});

test("rewriting the user segment to your own id does not pass", () => {
  const token = signRunCapability({ runId: RUN, userId: ALICE }, SECRET);
  const forged = token.replace(`.${ALICE}.`, `.${BOB}.`);
  assert.notEqual(forged, token);
  assert.equal(verifyRunCapability(forged, BOB, SECRET), null);
});

test("a tampered hmac is refused", () => {
  const token = signRunCapability({ runId: RUN, userId: ALICE }, SECRET);
  const last = token.at(-1);
  const flipped = token.slice(0, -1) + (last === "A" ? "B" : "A");
  assert.equal(verifyRunCapability(flipped, ALICE, SECRET), null);
  assert.equal(verifyRunCapability(token.slice(0, -2), ALICE, SECRET), null);
});

test("swapping in another run id under the same hmac is refused", () => {
  const token = signRunCapability({ runId: RUN, userId: ALICE }, SECRET);
  const other = token.replace(RUN, "wrun_01K5SOMEONEELSES000000000000");
  assert.equal(verifyRunCapability(other, ALICE, SECRET), null);
});

test("a bare run id, the form the route used to accept, is refused", () => {
  assert.equal(verifyRunCapability(RUN, ALICE, SECRET), null);
});

test("malformed tokens are refused rather than thrown on", () => {
  for (const token of ["", ".", "..", `${RUN}.${ALICE}.`, `.${ALICE}.abc`, `${RUN}..abc`, `${RUN}.${ALICE}`]) {
    assert.equal(verifyRunCapability(token, ALICE, SECRET), null, `accepted ${JSON.stringify(token)}`);
  }
});

test("a capability signed with a different secret is refused", () => {
  const token = signRunCapability({ runId: RUN, userId: ALICE }, "some-other-secret");
  assert.equal(verifyRunCapability(token, ALICE, SECRET), null);
});

test("a run id carrying a dot still round-trips", () => {
  // The workflow runtime tags run ids as `wrun_ABC.<tag>` in some worlds.
  const tagged = `${RUN}.vitest-0`;
  const token = signRunCapability({ runId: tagged, userId: ALICE }, SECRET);
  assert.equal(verifyRunCapability(token, ALICE, SECRET), tagged);
  assert.equal(verifyRunCapability(token, BOB, SECRET), null);
});

test("without a configured secret nothing is issued and nothing verifies", () => {
  assert.equal(runCapabilitySecret({}), null);
  assert.equal(runCapabilitySecret({ [RUN_CAPABILITY_SECRET_ENV]: "   " }), null);
  assert.equal(runCapabilitySecret({ [RUN_CAPABILITY_SECRET_ENV]: SECRET }), SECRET);

  assert.throws(() => signRunCapability({ runId: RUN, userId: ALICE }, null));
  const token = signRunCapability({ runId: RUN, userId: ALICE }, SECRET);
  assert.equal(verifyRunCapability(token, ALICE, null), null);
});

test("an id that would make the token ambiguous is not signed", () => {
  assert.throws(() => signRunCapability({ runId: "", userId: ALICE }, SECRET));
  assert.throws(() => signRunCapability({ runId: RUN, userId: "" }, SECRET));
  assert.throws(() => signRunCapability({ runId: RUN, userId: "a.b" }, SECRET));
  assert.throws(() => signRunCapability({ runId: "wrun/../x", userId: ALICE }, SECRET));
});
