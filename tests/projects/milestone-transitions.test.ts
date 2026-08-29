import assert from "node:assert/strict";
import { test } from "node:test";

import {
    MILESTONE_TRANSITIONS,
    canTransition,
    transitionRefusal,
} from "../../lib/projects/milestone-transitions";

/**
 * This table used to live inside update-milestone-modal.tsx, where it only ever
 * disabled a `SelectItem`. The WebMCP milestone tools dispatch the update thunk
 * without passing through that modal, so the rule now has to hold on its own.
 */

test("a milestone can only start or be waived from PENDING", () => {
    assert.ok(canTransition("PENDING", "ACTIVE"));
    assert.ok(canTransition("PENDING", "NOT_REQUIRED"));
    assert.ok(!canTransition("PENDING", "DONE"), "PENDING must not skip straight to DONE");
});

test("finishing is only reachable from ACTIVE", () => {
    assert.ok(canTransition("ACTIVE", "DONE"));
    assert.ok(!canTransition("ACTIVE", "PENDING"));
    assert.ok(!canTransition("ACTIVE", "NOT_REQUIRED"));
});

test("DONE is final but NOT_REQUIRED is not", () => {
    // Finishing work is a fact. Deciding work is unnecessary is a judgement,
    // and judgements get revisited when the scope changes.
    assert.deepEqual(MILESTONE_TRANSITIONS.DONE, []);
    assert.deepEqual(MILESTONE_TRANSITIONS.NOT_REQUIRED, ["PENDING"]);
});

test("every status has an entry, so a lookup cannot be undefined", () => {
    for (const status of ["PENDING", "ACTIVE", "DONE", "NOT_REQUIRED"] as const) {
        assert.ok(Array.isArray(MILESTONE_TRANSITIONS[status]), `${status} has no entry`);
    }
});

test("a refusal names the current status and what is actually possible", () => {
    // The agent's next move depends on this sentence: without the legal
    // targets it can only retry the same call.
    const message = transitionRefusal("Slab pour", "PENDING", "DONE");
    assert.match(message, /Slab pour/);
    assert.match(message, /PENDING/);
    assert.match(message, /ACTIVE or NOT_REQUIRED/);

    const terminal = transitionRefusal("Handover", "DONE", "ACTIVE");
    assert.match(terminal, /final/);
});
