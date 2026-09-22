import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyMention,
  composerKeyAction,
  findMentionTrigger,
} from "@/components/agent/agent-mentions";

test("the token under the caret is found, not the one at the end", () => {
  const value = "Check @smi and then @lot";
  // Caret sits right after "@smi", mid-message.
  const trigger = findMentionTrigger(value, 10);

  assert.deepEqual(trigger, { end: 10, query: "smi", start: 6 });
});

test("a mention at the very start of the message is found", () => {
  assert.deepEqual(findMentionTrigger("@smi", 4), {
    end: 4,
    query: "smi",
    start: 0,
  });
});

test("an email address is not read as a mention", () => {
  assert.equal(findMentionTrigger("write to bob@frame.com", 22), null);
});

test("the token ends at whitespace", () => {
  assert.equal(findMentionTrigger("@smith residence", 16), null);
});

test("a bare @ opens the picker with an empty query", () => {
  assert.deepEqual(findMentionTrigger("Check @", 7), {
    end: 7,
    query: "",
    start: 6,
  });
});

test("text with no mention yields no trigger", () => {
  assert.equal(findMentionTrigger("Find the latest offer", 21), null);
});

test("choosing a record keeps its label in the message", () => {
  const value = "Check @smi and then @lot";
  const trigger = findMentionTrigger(value, 10);
  assert.ok(trigger);

  const next = applyMention(value, trigger, "Smith Residence");

  // The token already had a space after it, so another is not added.
  assert.equal(next.value, "Check @Smith Residence and then @lot");
  assert.equal(next.caret, "Check @Smith Residence".length);
});

test("a trailing space is added when the caret is at the end", () => {
  const value = "Check @smi";
  const trigger = findMentionTrigger(value, 10);
  assert.ok(trigger);

  assert.equal(
    applyMention(value, trigger, "Smith Residence").value,
    "Check @Smith Residence ",
  );
});

test("choosing a record while editing mid-message leaves the tail intact", () => {
  const value = "@le needs the updated slab date";
  const trigger = findMentionTrigger(value, 3);
  assert.ok(trigger);

  const next = applyMention(value, trigger, "Lot 14");

  assert.equal(next.value, "@Lot 14 needs the updated slab date");
});

const menuShut = { menuOpen: false, resultCount: 0 };
const menuSearching = { menuOpen: true, resultCount: 0 };
const menuWithResults = { menuOpen: true, resultCount: 3 };

function press(
  key: string,
  options: { shiftKey?: boolean; isComposing?: boolean } = {},
) {
  return {
    isComposing: options.isComposing ?? false,
    key,
    shiftKey: options.shiftKey ?? false,
  };
}

test("Enter sends when the picker is shut", () => {
  assert.deepEqual(composerKeyAction(press("Enter"), menuShut), {
    kind: "send",
  });
});

test("Enter does not send while the picker is still searching", () => {
  // The regression this guards: the picker only claimed Enter once results had
  // arrived, so Enter pressed during the search sent the message with a
  // half-typed `@sm` still in it.
  assert.deepEqual(composerKeyAction(press("Enter"), menuSearching), {
    kind: "hold",
  });
});

test("Enter picks the highlighted record when there is one", () => {
  assert.deepEqual(composerKeyAction(press("Enter"), menuWithResults), {
    kind: "pick",
  });
});

test("Shift+Enter is always a new line", () => {
  for (const state of [menuShut, menuSearching, menuWithResults]) {
    assert.deepEqual(
      composerKeyAction(press("Enter", { shiftKey: true }), state),
      { kind: "ignore" },
    );
  }
});

test("the Enter that commits an IME candidate never sends", () => {
  for (const state of [menuShut, menuSearching, menuWithResults]) {
    assert.deepEqual(
      composerKeyAction(press("Enter", { isComposing: true }), state),
      { kind: "ignore" },
    );
  }
});

test("Escape dismisses the picker in every open state", () => {
  assert.deepEqual(composerKeyAction(press("Escape"), menuSearching), {
    kind: "dismiss",
  });
  assert.deepEqual(composerKeyAction(press("Escape"), menuWithResults), {
    kind: "dismiss",
  });
});

test("the arrows only belong to the picker when it has results", () => {
  assert.deepEqual(composerKeyAction(press("ArrowDown"), menuWithResults), {
    delta: 1,
    kind: "move",
  });
  assert.deepEqual(composerKeyAction(press("ArrowUp"), menuWithResults), {
    delta: -1,
    kind: "move",
  });
  assert.deepEqual(composerKeyAction(press("ArrowDown"), menuSearching), {
    kind: "ignore",
  });
});

test("Tab still moves focus when there is nothing to pick", () => {
  assert.deepEqual(composerKeyAction(press("Tab"), menuWithResults), {
    kind: "pick",
  });
  assert.deepEqual(composerKeyAction(press("Tab"), menuSearching), {
    kind: "ignore",
  });
  assert.deepEqual(composerKeyAction(press("Tab"), menuShut), {
    kind: "ignore",
  });
});
