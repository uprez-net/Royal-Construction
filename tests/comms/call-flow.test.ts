import assert from "node:assert/strict";
import { test } from "vitest";

import {
  decideAfterConsent,
  decideAfterDial,
  decideCallStart,
  type CallFlowContext,
  type CallForFlow,
} from "@/lib/domain/comms/calls/flow";

// The call router: pure, so every branch of what a customer hears is
// checkable without a carrier.

const inbound: CallForFlow = {
  businessNumber: "+61280001234",
  customerNumber: "+61412345678",
  direction: "INBOUND",
  flowStep: "RINGING_BROWSER",
  recordingConsent: "NOT_ASKED",
  staffIdentity: null,
  staffTarget: null,
};

const outbound: CallForFlow = {
  ...inbound,
  direction: "OUTBOUND",
  flowStep: "DIALING_CUSTOMER",
  staffIdentity: "crm_me",
  staffTarget: "BROWSER",
};

function ctx(
  overrides: Partial<CallFlowContext["channel"]> = {},
  identities = ["crm_a", "crm_b"],
): CallFlowContext {
  return {
    browserIdentities: identities,
    channel: {
      browserCalling: true,
      browserRingGroup: true,
      recordingMode: "off",
      staffForwardNumber: "+61400000000",
      ...overrides,
    },
  };
}

test("inbound with recording off rings every staff browser, unrecorded", () => {
  const decision = decideCallStart(inbound, ctx());
  assert.equal(decision.step, "RINGING_BROWSER");
  assert.deepEqual(decision.instructions, [
    {
      callerId: "+61412345678",
      identities: ["crm_a", "crm_b"],
      op: "dialBrowser",
      record: false,
      timeoutSeconds: 20,
    },
  ]);
});

test("a provider without a ring group rings the most recently seen browser only", () => {
  const decision = decideCallStart(inbound, ctx({ browserRingGroup: false }));
  const dial = decision.instructions[0];
  assert.equal(dial.op === "dialBrowser" && dial.identities.length, 1);
});

test("no browser open goes to the office mobile, presenting Royal's own number", () => {
  const decision = decideCallStart(inbound, ctx({}, []));
  assert.equal(decision.step, "RINGING_MOBILE");
  assert.deepEqual(decision.instructions[0], {
    callerId: "+61280001234",
    op: "dialNumber",
    record: false,
    timeoutSeconds: 20,
    to: "+61400000000",
  });
});

test("nobody to ring goes straight to voicemail", () => {
  const decision = decideCallStart(
    inbound,
    ctx({ staffForwardNumber: null }, []),
  );
  assert.equal(decision.step, "VOICEMAIL");
  assert.deepEqual(
    decision.instructions.map((step) => step.op),
    ["say", "recordVoicemail", "hangup"],
  );
});

test("consented mode asks first, and only a 1 starts recording", () => {
  const consented = ctx({ recordingMode: "consented" });
  const ask = decideCallStart(inbound, consented);
  assert.equal(ask.step, "RECORDING_CONSENT");
  assert.equal(ask.instructions[0].op, "gatherDigits");

  const yes = decideAfterConsent(
    { ...inbound, flowStep: "RECORDING_CONSENT" },
    consented,
    "1",
  );
  assert.equal(yes.recordingConsent, "GRANTED");
  assert.equal(
    yes.instructions[0].op === "dialBrowser" && yes.instructions[0].record,
    true,
  );

  for (const digits of ["2", "", "9", "11"]) {
    const no = decideAfterConsent(
      { ...inbound, flowStep: "RECORDING_CONSENT" },
      consented,
      digits,
    );
    assert.equal(no.recordingConsent, "DECLINED", `"${digits}" is not consent`);
    assert.equal(
      no.instructions[0].op === "dialBrowser" && no.instructions[0].record,
      false,
    );
  }
});

test("an unanswered browser ring falls back to the mobile, then voicemail", () => {
  const afterBrowser = decideAfterDial(inbound, ctx(), "no-answer");
  assert.equal(afterBrowser.step, "RINGING_MOBILE");
  const afterMobile = decideAfterDial(
    { ...inbound, flowStep: "RINGING_MOBILE" },
    ctx(),
    "busy",
  );
  assert.equal(afterMobile.step, "VOICEMAIL");
  const answered = decideAfterDial(inbound, ctx(), "answered");
  assert.deepEqual(answered, {
    instructions: [{ op: "hangup" }],
    step: "ENDED",
  });
});

test("outbound: the customer is greeted and put through to whoever pressed Call", () => {
  const decision = decideCallStart(outbound, ctx());
  assert.equal(decision.step, "RINGING_BROWSER");
  assert.equal(decision.instructions[0].op, "say");
  const dial = decision.instructions[1];
  assert.deepEqual(
    dial.op === "dialBrowser" && dial.identities,
    ["crm_me"],
    "only the caller's own browser",
  );

  const mobile = decideCallStart({ ...outbound, staffTarget: "MOBILE" }, ctx());
  assert.equal(mobile.step, "RINGING_MOBILE");

  const nobody = decideAfterDial(
    { ...outbound, flowStep: "RINGING_BROWSER" },
    ctx(),
    "no-answer",
  );
  assert.equal(
    nobody.step,
    "ENDED",
    "an outbound call never goes to Royal's voicemail",
  );
  assert.deepEqual(
    nobody.instructions.map((step) => step.op),
    ["say", "hangup"],
  );
});
