import assert from "node:assert/strict";
import type { EveDynamicToolPart } from "eve/react";
import { test } from "vitest";

import { respondedNotice } from "@/components/agent/agent-approval";
import { resultFacts } from "@/components/agent/agent-format";
import {
  cancelNotice,
  delegateTitle,
  toolStateLabel,
} from "@/components/agent/agent-tool-call";
import { distinctConversationTitle } from "@/lib/agent/conversation-title";

// #432 item 5: what the /agent workspace cards say.

test("a delegate card says which specialists it is asking", () => {
  assert.equal(
    delegateTitle({ request: "x", specialist: "tradie-operations" }),
    "Asking the tradie specialist",
  );
  assert.equal(
    delegateTitle({
      tasks: [
        { id: "a", request: "x", specialist: "lead-operations" },
        { id: "b", request: "y", specialist: "project-operations" },
        { id: "c", request: "z", specialist: "lead-operations" },
      ],
    }),
    "Asking the lead and project specialists",
  );
  assert.equal(delegateTitle(undefined), null);
});

test("an approved card says it is applying the change, then stops spinning", () => {
  const working = {
    applying: true,
    partial: false,
    responded: true,
    working: true,
  };
  assert.equal(
    toolStateLabel("approval-responded", working),
    "Applying your change…",
  );
  // The turn finished: no "running" left on a card whose reply is shown.
  assert.equal(
    toolStateLabel("approval-responded", {
      ...working,
      applying: false,
      working: false,
    }),
    "Approved",
  );
  assert.equal(
    respondedNotice({ applying: true, cancelled: false, isApproval: true }),
    "Approved. Applying your change…",
  );
  assert.equal(
    respondedNotice({ applying: false, cancelled: true, isApproval: true }),
    "You cancelled this. Nothing was changed.",
  );
  assert.equal(
    respondedNotice({ applying: false, cancelled: false, isApproval: false }),
    "Answer sent.",
  );
});

test("an approval held by the rest of its step says what it is waiting for (#616)", () => {
  assert.equal(
    respondedNotice({
      applying: true,
      cancelled: false,
      isApproval: true,
      waitingOn: 4,
    }),
    "Approved: runs once the other 4 changes are answered.",
  );
  assert.equal(
    respondedNotice({
      applying: true,
      cancelled: false,
      isApproval: true,
      waitingOn: 1,
    }),
    "Approved: runs once the other change is answered.",
  );
});

test("a cancelled change is called cancelled, the word on the button", () => {
  const denied = {
    approval: {
      approved: false,
      id: "a1",
      reason: "Tool execution was cancelled.",
    },
    input: {},
    state: "output-denied",
    toolCallId: "c1",
    toolName: "update_lead",
    type: "dynamic-tool",
  } as unknown as EveDynamicToolPart;
  assert.equal(
    cancelNotice(denied),
    "You cancelled this. Nothing was changed.",
  );
  assert.equal(
    toolStateLabel("output-denied", {
      applying: false,
      partial: false,
      responded: true,
      working: false,
    }),
    "Cancelled",
  );

  const withNote = {
    ...denied,
    approval: { approved: false, id: "a1", reason: "Wrong lead" },
  } as unknown as EveDynamicToolPart;
  assert.equal(
    cancelNotice(withNote),
    "You cancelled this. Nothing was changed. Your note: Wrong lead",
  );
});

test("result facts read as words: no CALL, no false, one Due", () => {
  const facts = resultFacts({
    approved: false,
    dueAt: "2026-11-15T13:00:00.000Z",
    dueTime: "10:00",
    leadId: 105,
    type: "CALL",
  });
  assert.deepEqual(
    facts.map((fact) => [fact.label, fact.value]),
    [
      ["Approved", "No"],
      ["Due", "Mon 16 Nov 2026, 10:00 am"],
      ["Type", "Call"],
    ],
  );
});

test("a task's own time wins over the clock inside dueAt", () => {
  const [due] = resultFacts({
    dueAt: "2026-09-25T11:00:00+10:00",
    dueTime: "10:00",
  });
  assert.deepEqual(
    [due.label, due.value],
    ["Due", "Fri 25 Sept 2026, 10:00 am"],
  );
  // Without a task time, dueAt's own clock is what there is.
  assert.equal(
    resultFacts({ dueAt: "2026-09-25T11:00:00+10:00" })[0].value,
    "Fri 25 Sept 2026, 11:00 am AEST",
  );
});

test("a repeated conversation title is told apart by its day", () => {
  const startedAt = new Date("2026-11-13T04:07:00Z");
  assert.equal(
    distinctConversationTitle("Sandhu Tender Follow-up", [], startedAt),
    "Sandhu Tender Follow-up",
  );
  const once = distinctConversationTitle(
    "Weekly Task and Deadline Review",
    ["Weekly task and deadline review"],
    startedAt,
  );
  assert.equal(once, "Weekly Task and Deadline Review · Fri 13 Nov 2026");
  const twice = distinctConversationTitle(
    "Weekly Task and Deadline Review",
    ["Weekly Task and Deadline Review", once],
    startedAt,
  );
  assert.match(
    twice,
    /^Weekly Task and Deadline Review · Fri 13 Nov 2026, 3:07/,
  );
  const thrice = distinctConversationTitle(
    "Weekly Task and Deadline Review",
    ["Weekly Task and Deadline Review", once, twice],
    startedAt,
  );
  assert.equal(thrice, `${twice} (2)`);
});
