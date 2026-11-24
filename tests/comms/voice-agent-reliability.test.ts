import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { CallFlowStep, MilestoneStatus } from "@prisma/client";
import { describe, test } from "vitest";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import {
  GREETING_GIVE_UP_MS,
  GREETING_RETRY_MS,
  PREPARE_TIMEOUT_MS,
  TURN_QUIET_MS,
  type VoiceAgentReportBody,
} from "@/lib/comms/voice-agent/session";
import { handleVoiceAgentStream } from "@/lib/comms/voice-agent/stream-handler";
import { checkpointAgentTranscript } from "@/lib/domain/comms/calls/agent-transcript";
import {
  VOICE_DELEGATION_NOTHING_TO_RUN_CUE,
  voiceAgentDeskInstructions,
  voiceAgentInstructions,
  type VoiceCallerContext,
} from "@/lib/domain/comms/calls/voice-agent";
import { stageLines } from "@/lib/domain/comms/callers/briefing-lines";
import { runVoiceLookup } from "@/lib/domain/comms/callers/lookups";
import { projectSearchVariants } from "@/lib/domain/comms/callers/project-search";
import { DomainAuthorizationError } from "@/lib/domain/errors";
import { systemPrincipal, userPrincipal } from "@/lib/domain/principal";

import { recordingDb } from "../architecture/domain-harness";
import { callerDb, principal } from "./voice-caller-fixtures";
import {
  ENV,
  harness,
  SPEECH,
  started,
  telnyxStart,
  token,
} from "./voice-agent-harness";

// What the production call review of 24 Nov 2026 found Mili getting wrong
// (issues #605–#612), each pinned here so it stays fixed.

const speech = (bytes = 8_000) => ({
  delta: Buffer.alloc(bytes, SPEECH).toString("base64"),
  type: "session.output_audio.delta" as const,
});

function capturingLog() {
  const lines: { level: string; text: string }[] = [];
  const at =
    (level: string) =>
    (...args: unknown[]) =>
      lines.push({ level, text: args.map(String).join(" ") });
  return {
    lines,
    log: { error: at("error"), info: at("info"), warn: at("warn") },
  };
}

// ── #605: the transcript survives the caller hanging up ─────────────────

describe("her transcript is not lost when the caller hangs up (#605)", () => {
  test("the stream keeps its function alive until the session has reported", async () => {
    const kept: Promise<unknown>[] = [];
    const ws = Object.assign(new EventEmitter(), {
      OPEN: 1,
      close: () => {},
      readyState: 1,
      send: () => {},
    });
    const response = await handleVoiceAgentStream(
      new Request("https://royal.example/api/comms/voice-agent/telnyx", {
        headers: { upgrade: "websocket" },
      }),
      { provider: "telnyx" },
      {
        db: recordingDb() as never,
        keepAlive: (promise) => kept.push(promise),
        log: capturingLog().log,
        runtime: commsRuntimeFromEnv(ENV),
        upgrade: async (handler) => {
          const running = handler(ws as never);
          // The carrier hangs up before the call ever started.
          ws.emit("close");
          await running;
          return new Response(null, { status: 204 });
        },
      },
    );
    assert.equal(response.status, 204);
    assert.equal(kept.length, 1, "the session's end is handed to waitUntil");
    await kept[0];
  });

  test("what has been said is kept on the call while she talks, at most every few seconds", async () => {
    const kept: Omit<VoiceAgentReportBody, "outcome">[] = [];
    const h = await started(undefined, undefined, {
      checkpoint: async (body) => {
        kept.push(body);
      },
    });
    h.session.handleModelEvent({
      delta: "Hi, you're speaking with Mili.",
      endMs: 900,
      startMs: 0,
      type: "session.output_transcript.delta",
    });
    h.session.handleModelEvent(speech());
    h.fire(TURN_QUIET_MS);
    await h.tick();
    assert.equal(kept.length, 1);
    assert.equal(kept[0].callId, "call-1");
    assert.equal(kept[0].callControlId, "v3:abc");
    assert.deepEqual(kept[0].turns, [
      { speaker: "agent", text: "Hi, you're speaking with Mili." },
    ]);

    // More words a moment later: not yet.
    h.session.handleModelEvent({
      delta: "I need a call back.",
      endMs: 3_000,
      startMs: 2_000,
      type: "session.input_transcript.delta",
    });
    h.session.handleModelEvent(speech());
    h.fire(TURN_QUIET_MS);
    assert.equal(kept.length, 1);

    // Five seconds on, with more said: kept again.
    h.advance(5_000);
    h.session.handleModelEvent(speech());
    h.fire(TURN_QUIET_MS);
    assert.equal(kept.length, 2);
    assert.equal(kept[1].turns.length, 2);
  });

  test("a checkpoint that fails never disturbs the call", async () => {
    const h = await started(undefined, undefined, {
      checkpoint: async () => {
        throw new Error("database down");
      },
    });
    h.session.handleModelEvent({
      delta: "Hello.",
      endMs: 500,
      startMs: 0,
      type: "session.output_transcript.delta",
    });
    h.session.handleModelEvent(speech());
    h.fire(TURN_QUIET_MS);
    await h.tick();
    assert.equal(h.reports.length, 0);
    assert.equal(h.state.carrierClosed, false);
  });

  test("the checkpoint writes only while the call is still with her", async () => {
    const recorder = recordingDb({ "call.updateMany": { count: 1 } });
    const saved = await checkpointAgentTranscript(
      systemPrincipal("comms-webhook"),
      {
        callId: "call-1",
        provider: "telnyx",
        providerCallId: "v3:abc",
        transcript: "Mili: Hello.",
      },
      recorder.db,
    );
    assert.equal(saved, true);
    const [write] = recorder.writes();
    assert.equal(write.operation, "call.updateMany");
    assert.deepEqual(write.args, {
      data: { agentTranscript: "Mili: Hello." },
      where: {
        flowStep: CallFlowStep.AGENT,
        id: "call-1",
        provider: "TELNYX",
        providerCallId: "v3:abc",
      },
    });
  });

  test("only the voice agent's stream may checkpoint, and an empty transcript writes nothing", async () => {
    const recorder = recordingDb();
    await assert.rejects(
      checkpointAgentTranscript(
        userPrincipal({ id: "u-1", role: "ADMIN" } as never),
        {
          callId: "call-1",
          provider: "telnyx",
          providerCallId: "v3:abc",
          transcript: "Mili: Hello.",
        },
        recorder.db,
      ),
      DomainAuthorizationError,
    );
    assert.equal(
      await checkpointAgentTranscript(
        systemPrincipal("comms-webhook"),
        {
          callId: "call-1",
          provider: "telnyx",
          providerCallId: "v3:abc",
          transcript: "  ",
        },
        recorder.db,
      ),
      false,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});

// ── #606: no dead air after "let me check" ──────────────────────────────

describe("a delegation with nothing to run is answered, not left open (#606)", () => {
  test("no lookup for it: Mili is told to answer the caller now", async () => {
    const h = await started(async () => null);
    h.session.handleModelEvent({
      delegationId: "item_9",
      type: "session.delegation.created",
    });
    await h.tick();
    assert.deepEqual(h.modelOut.at(-1), {
      content: VOICE_DELEGATION_NOTHING_TO_RUN_CUE,
      delegation_id: "item_9",
      type: "session.thinking.append",
    });
    assert.match(VOICE_DELEGATION_NOTHING_TO_RUN_CUE, /Answer the caller now/);
    assert.doesNotMatch(VOICE_DELEGATION_NOTHING_TO_RUN_CUE, /yet/);
  });

  test("a desk that fails answers the delegation the same way", async () => {
    const h = await started(async () => {
      throw new Error("desk timed out");
    });
    h.session.handleModelEvent({
      delegationId: "item_9",
      type: "session.delegation.created",
    });
    await h.tick();
    assert.equal(
      (h.modelOut.at(-1) as { content?: string }).content,
      VOICE_DELEGATION_NOTHING_TO_RUN_CUE,
    );
  });

  const client: VoiceCallerContext = {
    briefing: "Their project: under construction.",
    callerClass: "client",
    canLookUp: false,
    firstName: "Chris",
  };

  test("a caller with no lookups is never promised a check", () => {
    for (const instructions of [
      voiceAgentInstructions(null),
      voiceAgentInstructions(client),
    ]) {
      assert.match(instructions, /no way to look anything up/);
      assert.match(instructions, /Never say you will check something/);
    }
    const admin = voiceAgentInstructions({
      ...client,
      callerClass: "admin",
      canLookUp: true,
    });
    assert.doesNotMatch(admin, /no way to look anything up/);
    assert.match(admin, /One moment, let me check that/);
  });
});

// ── #607: transfers ─────────────────────────────────────────────────────

describe("asking for a person is put through; leaving is not (#607)", () => {
  test("Mili puts a request for a supervisor straight through, and lets a leaving caller go", () => {
    const instructions = voiceAgentInstructions(null);
    assert.match(instructions, /a supervisor, a manager/);
    assert.match(instructions, /Do not take a message first/);
    assert.match(
      instructions,
      /says they need to go[^\n]*do not put them through/,
    );
  });

  test("the desk never transfers a caller who is leaving", () => {
    const desk = voiceAgentDeskInstructions();
    assert.match(
      desk,
      /Never call transfer_to_team for a caller who has said they need to go/,
    );
    assert.match(desk, /Call end_call once she has said goodbye/);
  });
});

// ── #611: spelled words and corrections ─────────────────────────────────

test("spelled words and corrections are taken exactly (#611)", () => {
  for (const instructions of [
    voiceAgentInstructions(null),
    voiceAgentInstructions({
      briefing: "-",
      callerClass: "tradie",
      canLookUp: false,
      firstName: null,
    }),
  ]) {
    assert.match(instructions, /use exactly those letters/);
    assert.match(instructions, /Never say again the version they corrected/);
    assert.match(
      instructions,
      /ask the caller to spell it rather than guessing/,
    );
  }
});

// ── #608: a greeting that never comes ───────────────────────────────────

describe("her greeting is watched (#608)", () => {
  test("silent after Live started: cued again, then the caller goes to a person", async () => {
    const { lines, log } = capturingLog();
    const h = await started(undefined, undefined, { log });
    const cues = () =>
      h.modelOut.filter(
        (event) =>
          event.type === "session.commentary.append"
          && /Greet them first/.test(event.content),
      ).length;
    assert.equal(cues(), 1);
    h.fire(GREETING_RETRY_MS);
    assert.equal(cues(), 2, "the greeting cue is sent again");
    h.fire(GREETING_GIVE_UP_MS);
    await h.session.done;
    assert.equal(h.reports[0]?.outcome, "failed");
    const summary = lines.find((line) => line.text.includes("call summary"));
    assert.ok(summary, "one summary line for the call");
    assert.match(summary.text, /outcome=failed/);
    assert.match(summary.text, /firstWords=-/);
    assert.match(summary.text, /greetingRetried=true/);
  });

  test("once she has spoken, nothing is re-cued and the call goes on", async () => {
    const h = await started();
    h.session.handleModelEvent(speech());
    h.fire(GREETING_RETRY_MS);
    h.fire(GREETING_GIVE_UP_MS);
    await h.tick();
    assert.equal(h.reports.length, 0);
    assert.equal(
      h.modelOut.filter((event) => event.type === "session.commentary.append")
        .length,
      1,
    );
  });

  test("a caller resolution that times out is logged, not silent (#612)", async () => {
    const { lines, log } = capturingLog();
    const h = harness(
      "telnyx",
      token("telnyx", "v3:abc"),
      undefined,
      () => new Promise(() => {}),
      { log },
    );
    h.session.handleCarrierText(telnyxStart());
    await h.tick();
    h.fire(PREPARE_TIMEOUT_MS);
    await h.tick();
    assert.ok(
      lines.some(
        (line) =>
          line.level === "error" && /not resolved within/.test(line.text),
      ),
    );
    // She still starts, as for an unknown caller.
    assert.equal(h.modelOut[0]?.type, "session.start");
    h.session.handleModelEvent({ type: "session.started" });
    h.session.handleCarrierClosed();
    await h.session.done;
    const summary = lines.find((line) => line.text.includes("call summary"));
    assert.match(summary?.text ?? "", /caller=unresolved-timeout/);
  });
});

// ── #609: "Street" and "St" ─────────────────────────────────────────────

describe("an address finds its project however it is said (#609)", () => {
  test("the street type both ways, then the number and street, then a lot number", () => {
    assert.deepEqual(projectSearchVariants("12 Example Street"), [
      "12 Example Street",
      "12 Example St",
      "12 Example",
    ]);
    assert.deepEqual(projectSearchVariants("12 Smith Rd, Oran Park"), [
      "12 Smith Rd, Oran Park",
      "12 Smith Road, Oran Park",
      "12 Smith",
    ]);
    assert.deepEqual(projectSearchVariants("lot number 1234"), [
      "lot number 1234",
      "Lot 1234",
    ]);
    assert.deepEqual(projectSearchVariants("1234"), ["1234", "Lot 1234"]);
    assert.deepEqual(projectSearchVariants("Ridge"), ["Ridge"]);
    // "1st" is not a street type.
    assert.deepEqual(projectSearchVariants("1st Avenue build").slice(0, 2), [
      "1st Avenue build",
      "1st Ave build",
    ]);
  });

  test("the lookup tries the next spelling when the words as said find nothing", async () => {
    const queries: string[] = [];
    const found = {
      id: "p-1",
      location: "56 Sample St, Suburbia",
      name: "Lot 1, 56 Sample St",
    };
    const matches = (args: { where?: unknown }) => {
      const text = JSON.stringify(args.where ?? {});
      const query = /"contains":"([^"]+)"/.exec(text)?.[1] ?? "";
      queries.push(query);
      return query === "56 Sample St" ? [found] : [];
    };
    const recorder = callerDb("admin", {
      "project.count": (args: { where?: unknown }) =>
        JSON.stringify(args.where ?? {}).includes('"56 Sample St"') ? 1 : 0,
      "project.findFirstOrThrow": {
        ...found,
        milestones: [],
        siteManager: null,
        status: "IN_PROGRESS",
        tradieSchedules: [],
      },
      "project.findMany": matches,
    });
    const result = await runVoiceLookup(
      principal({ class: "admin", firstName: "Alex", userId: "u-admin" }),
      { name: "project_status", project: "56 Sample Street" },
      recorder.db,
      { now: new Date("2026-11-24T01:00:00Z") },
    );
    assert.deepEqual(queries, ["56 Sample Street", "56 Sample St"]);
    assert.match(result.text, /Lot 1, 56 Sample St at 56 Sample St/);
  });
});

// ── #610: past dates ────────────────────────────────────────────────────

describe("a date that has passed is never read as the schedule (#610)", () => {
  const NOW = new Date("2026-11-24T01:00:00Z");
  const day = (iso: string) => new Date(`${iso}T00:00:00+11:00`);

  test("a stage not started whose start date has gone", () => {
    const text = stageLines(
      [
        {
          name: "Frame inspection",
          startDate: day("2026-11-12"),
          status: MilestoneStatus.PENDING,
          targetDate: day("2026-11-13"),
        },
        {
          name: "Bricklaying",
          startDate: day("2026-11-27"),
          status: MilestoneStatus.PENDING,
          targetDate: day("2026-12-04"),
        },
      ],
      NOW,
      "",
    ).join("\n");
    assert.doesNotMatch(text, /12 November/);
    assert.match(
      text,
      /Frame inspection \(not started; its scheduled start date has passed; the team will confirm the new dates\)/,
    );
    assert.match(
      text,
      /Bricklaying \(not started; the current schedule shows Friday 27 November/,
    );
    assert.doesNotMatch(text, /delayed/i, "never an internal flag to a client");
  });

  test("a stage in progress past its finish date", () => {
    const text = stageLines(
      [
        {
          name: "Roofing",
          startDate: day("2026-11-02"),
          status: MilestoneStatus.ACTIVE,
          targetDate: day("2026-11-20"),
        },
      ],
      NOW,
      "",
    ).join("\n");
    assert.doesNotMatch(text, /20 November/);
    assert.match(text, /its scheduled finish date has passed/);
  });

  test("today is not the past", () => {
    const text = stageLines(
      [
        {
          name: "Slab",
          startDate: day("2026-11-24"),
          status: MilestoneStatus.PENDING,
          targetDate: day("2026-11-25"),
        },
      ],
      NOW,
      "",
    ).join("\n");
    assert.match(text, /the current schedule shows Tuesday 24 November/);
  });
});
