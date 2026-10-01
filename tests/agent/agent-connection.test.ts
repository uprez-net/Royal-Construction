import assert from "node:assert/strict";
import { test } from "vitest";

import {
  classifySendFailure,
  draftStorageKey,
  isStalledTurn,
  isTerminalSessionStatus,
  STALL_AFTER_MS,
} from "@/components/agent/agent-connection";

test("only an ended session is read-only", () => {
  assert.equal(isTerminalSessionStatus("COMPLETED"), true);
  assert.equal(isTerminalSessionStatus("FAILED"), true);
  assert.equal(isTerminalSessionStatus("WAITING"), false);
  assert.equal(isTerminalSessionStatus("ACTIVE"), false);
  assert.equal(isTerminalSessionStatus(undefined), false);
});

test("a first message is sent once its session exists, even if the stream was refused", () => {
  // Staging: the create returned 202 and the turn ran, but the stream's
  // ownership wait expired first and the operator was told nothing was sent.
  const refused = Object.assign(
    new Error("The requested agent session is unavailable."),
    { code: "agent_session_access_denied", status: 403 },
  );
  assert.equal(
    classifySendFailure({
      error: refused,
      sessionAfter: "wrun_new",
      sessionBefore: null,
    }),
    "accepted",
  );
});

test("a first message whose session was never created was not sent", () => {
  assert.equal(
    classifySendFailure({
      error: new Error("Failed to fetch"),
      sessionAfter: null,
      sessionBefore: null,
    }),
    "failed",
  );
});

test("a follow-up refused by its session is not reported as sent", () => {
  const refused = Object.assign(new Error("unavailable"), {
    code: "agent_session_access_denied",
    status: 403,
  });
  assert.equal(
    classifySendFailure({
      error: refused,
      sessionAfter: "wrun_old",
      sessionBefore: "wrun_old",
    }),
    "failed",
  );
});

test("an ended session is recognised by Eve's stable code, not retried", () => {
  const ended = Object.assign(new Error("The session is no longer active."), {
    code: "session_not_active",
    status: 409,
  });
  assert.equal(
    classifySendFailure({
      error: ended,
      sessionAfter: "wrun_old",
      sessionBefore: "wrun_old",
    }),
    "closed",
  );
});

test("a quiet turn is a stall only while busy and not waiting on a person", () => {
  const quiet = { lastEventAt: 0, now: STALL_AFTER_MS };
  assert.equal(
    isStalledTurn({ ...quiet, busy: true, pendingApprovals: 0 }),
    true,
  );
  assert.equal(
    isStalledTurn({ ...quiet, busy: true, pendingApprovals: 1 }),
    false,
  );
  assert.equal(
    isStalledTurn({ ...quiet, busy: false, pendingApprovals: 0 }),
    false,
  );
  assert.equal(
    isStalledTurn({
      busy: true,
      lastEventAt: 0,
      now: STALL_AFTER_MS - 1,
      pendingApprovals: 0,
    }),
    false,
  );
});

test("drafts are kept per conversation", () => {
  assert.notEqual(draftStorageKey("wrun_a"), draftStorageKey("wrun_b"));
  assert.notEqual(draftStorageKey(null), draftStorageKey("wrun_a"));
});
