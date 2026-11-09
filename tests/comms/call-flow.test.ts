import assert from "node:assert/strict";
import { test } from "vitest";

import {
  decideAfterAgent,
  decideAfterConsent,
  decideAfterDial,
  decideCallStart,
  PROMPTS,
  type CallFlowContext,
  type CallForFlow,
} from "@/lib/domain/comms/calls/flow";
import { VOICE_AGENT_MAX_SECONDS } from "@/lib/domain/comms/calls/voice-agent";

// The call router: pure, so every branch of what a customer hears is
// checkable without a carrier. Inbound calls are told they are recorded and
// answered by Mili; outbound calls are put through to staff.

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
): CallFlowContext {
  return {
    channel: {
      browserCalling: true,
      recordingMode: "off",
      staffForwardNumber: "+61400000000",
      voiceAgent: true,
      ...overrides,
    },
  };
}

const withMili: CallForFlow = {
  ...inbound,
  flowStep: "AGENT",
  recordingConsent: "DECLARED",
};

test("inbound: the recording declaration plays first, then Mili picks up, recorded", () => {
  const decision = decideCallStart(inbound, ctx());
  assert.equal(decision.step, "AGENT");
  assert.equal(decision.recordingConsent, "DECLARED");
  assert.deepEqual(decision.instructions, [
    { op: "say", text: PROMPTS.recordingDeclaration },
    { maxSeconds: VOICE_AGENT_MAX_SECONDS, op: "connectAgent", record: true },
  ]);
});

test("inbound never rings a staff browser, whatever the channel can do", () => {
  for (const voiceAgent of [true, false]) {
    for (const staffForwardNumber of ["+61400000000", null]) {
      const decision = decideCallStart(
        inbound,
        ctx({ browserCalling: true, staffForwardNumber, voiceAgent }),
      );
      assert.equal(
        decision.instructions.some((step) => step.op === "dialBrowser"),
        false,
      );
      assert.notEqual(decision.step, "RINGING_BROWSER");
    }
  }
});

test("inbound declares recording even when outbound recording is off or consented", () => {
  for (const recordingMode of ["off", "consented"] as const) {
    const decision = decideCallStart(inbound, ctx({ recordingMode }));
    assert.deepEqual(decision.instructions[0], {
      op: "say",
      text: PROMPTS.recordingDeclaration,
    });
    assert.notEqual(decision.step, "RECORDING_CONSENT");
  }
});

test("without Mili, inbound goes to the office mobile, recorded, presenting Royal's own number", () => {
  const decision = decideCallStart(inbound, ctx({ voiceAgent: false }));
  assert.equal(decision.step, "RINGING_MOBILE");
  assert.deepEqual(decision.instructions, [
    { op: "say", text: PROMPTS.recordingDeclaration },
    {
      callerId: "+61280001234",
      op: "dialNumber",
      record: true,
      timeoutSeconds: 20,
      to: "+61400000000",
    },
  ]);
});

test("without Mili or a mobile, inbound goes straight to voicemail", () => {
  const decision = decideCallStart(
    inbound,
    ctx({ staffForwardNumber: null, voiceAgent: false }),
  );
  assert.equal(decision.step, "VOICEMAIL");
  assert.deepEqual(
    decision.instructions.map((step) => step.op),
    ["say", "say", "recordVoicemail", "hangup"],
  );
});

test("Mili finished: hang up", () => {
  assert.deepEqual(decideAfterAgent(withMili, ctx(), "completed"), {
    instructions: [{ op: "hangup" }],
    step: "ENDED",
  });
});

test("asked for a person: Mili hands over to the office mobile, recording kept", () => {
  const decision = decideAfterAgent(withMili, ctx(), "transfer");
  assert.equal(decision.step, "RINGING_MOBILE");
  assert.deepEqual(decision.instructions.slice(0, 2), [
    { op: "stopAgent", stopRecording: false },
    { op: "say", text: PROMPTS.agentTransfer },
  ]);
  const dial = decision.instructions[2];
  assert.equal(dial.op === "dialNumber" && dial.record, true);
});

test("Mili unreachable with no mobile: voicemail, and her recording stops first", () => {
  const decision = decideAfterAgent(
    withMili,
    ctx({ staffForwardNumber: null }),
    "failed",
  );
  assert.equal(decision.step, "VOICEMAIL");
  assert.deepEqual(decision.instructions[0], {
    op: "stopAgent",
    stopRecording: true,
  });
  assert.deepEqual(
    decision.instructions.map((step) => step.op),
    ["stopAgent", "say", "recordVoicemail", "hangup"],
  );
});

test("Mili unreachable: the caller hears why, then the mobile rings", () => {
  const decision = decideAfterAgent(withMili, ctx(), "failed");
  assert.equal(decision.step, "RINGING_MOBILE");
  assert.deepEqual(decision.instructions[1], {
    op: "say",
    text: PROMPTS.agentUnavailable,
  });
});

test("an unanswered mobile after Mili goes to voicemail", () => {
  const afterMobile = decideAfterDial(
    { ...withMili, flowStep: "RINGING_MOBILE" },
    ctx(),
    "busy",
  );
  assert.equal(afterMobile.step, "VOICEMAIL");
  const answered = decideAfterDial(
    { ...withMili, flowStep: "RINGING_MOBILE" },
    ctx(),
    "answered",
  );
  assert.deepEqual(answered, {
    instructions: [{ op: "hangup" }],
    step: "ENDED",
  });
});

test("outbound consented mode asks first, and only a 1 starts recording", () => {
  const consented = ctx({ recordingMode: "consented" });
  const ask = decideCallStart(outbound, consented);
  assert.equal(ask.step, "RECORDING_CONSENT");
  assert.equal(ask.instructions[0].op, "gatherDigits");

  const yes = decideAfterConsent(
    { ...outbound, flowStep: "RECORDING_CONSENT" },
    consented,
    "1",
  );
  assert.equal(yes.recordingConsent, "GRANTED");
  const yesDial = yes.instructions[1];
  assert.equal(yesDial.op === "dialBrowser" && yesDial.record, true);

  for (const digits of ["2", "", "9", "11"]) {
    const no = decideAfterConsent(
      { ...outbound, flowStep: "RECORDING_CONSENT" },
      consented,
      digits,
    );
    assert.equal(no.recordingConsent, "DECLINED", `"${digits}" is not consent`);
    const noDial = no.instructions[1];
    assert.equal(noDial.op === "dialBrowser" && noDial.record, false);
  }
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
