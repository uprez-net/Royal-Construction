import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import {
  AWAITING_TRADIE_REPLY,
  findTradieReplyReference,
  isReplyFromTradie,
  matchTradieReplyToSchedule,
  referencedReplyTargets,
  tradieReplyStatus,
} from "@/lib/domain/tradies/replies";
import {
  extractTradieRefToken,
  subjectWithTradieRef,
} from "@/lib/domain/tradies/reply-reference";
import { REPO_ROOT } from "../support/repo-root";
import { recordingDb } from "./domain-harness";

// A tradie answering "Yes, confirmed" gave the extractor no date, the webhook
// passed `new Date("")` to Prisma, and the reply was lost (production,
// Oct 2026). The date and address are hints now, never the whole match.

const booking = (
  id: string,
  day: string,
  location: string,
  status: TradieScheduleStatus = TradieScheduleStatus.PENDING,
) => ({
  id,
  project: { location, name: `Project ${id}` },
  scheduledDate: new Date(`${day}T00:00:00.000Z`),
  status,
});

const ORION = "Lot 328, 161 Orion Road, Austral NSW 2179";

async function match(
  open: ReturnType<typeof booking>[],
  hints: { scheduleDate?: string | null; projectLocation?: string | null },
) {
  const recorder = recordingDb({ "tradieSchedule.findMany": open });
  const result = await matchTradieReplyToSchedule(
    { hints, tradieId: "t_1" },
    recorder.db,
  );
  return { recorder, result };
}

test("a bare 'yes' with no date matches the tradie's only open booking", async () => {
  const { result, recorder } = await match(
    [booking("s_1", "2026-10-12", ORION)],
    {
      projectLocation: "",
      scheduleDate: "",
    },
  );
  assert.equal(result.kind, "matched");
  assert.equal(result.kind === "matched" && result.schedule.id, "s_1");
  // Only open bookings are read, and COMPLETED is not one of them.
  const where = (
    recorder.calls[0]?.args as { where: { status: { in: string[] } } }
  ).where;
  assert.deepEqual(where.status.in, [...AWAITING_TRADIE_REPLY]);
  assert.ok(!AWAITING_TRADIE_REPLY.includes(TradieScheduleStatus.COMPLETED));
});

test("an unreadable date is ignored rather than sent to the database", async () => {
  for (const scheduleDate of [
    "",
    "next Tuesday",
    "12/10/2026",
    "2026-02-31",
    null,
  ]) {
    const { result } = await match([booking("s_1", "2026-10-12", ORION)], {
      scheduleDate,
    });
    assert.equal(result.kind, "matched", String(scheduleDate));
  }
});

test("a usable date or address narrows several open bookings", async () => {
  const open = [
    booking("s_1", "2026-10-12", ORION),
    booking("s_2", "2026-10-20", "4 Smith St, Parramatta NSW 2150"),
  ];
  const byDate = await match(open, { scheduleDate: "2026-10-20" });
  assert.equal(
    byDate.result.kind === "matched" && byDate.result.schedule.id,
    "s_2",
  );

  // An address that is neither site narrows nothing.
  const elsewhere = await match(open, {
    projectLocation: "9 Unrelated Ave, Penrith",
  });
  assert.equal(elsewhere.result.kind, "ambiguous");

  const byExactAddress = await match(open, {
    projectLocation: "161 Orion Road, Austral",
  });
  assert.equal(
    byExactAddress.result.kind === "matched"
      && byExactAddress.result.schedule.id,
    "s_1",
  );
});

test("several open bookings and nothing to tell them apart is ambiguous, not a guess", async () => {
  const { result } = await match(
    [booking("s_1", "2026-10-12", ORION), booking("s_2", "2026-10-20", ORION)],
    { scheduleDate: "" },
  );
  assert.equal(result.kind, "ambiguous");
  assert.equal(result.kind === "ambiguous" && result.candidates.length, 2);
});

test("a date that matches no booking is treated as a misread, not a refusal", async () => {
  const { result } = await match([booking("s_1", "2026-10-12", ORION)], {
    scheduleDate: "2026-11-01",
  });
  assert.equal(result.kind, "matched");
});

test("no open booking is none", async () => {
  const { result } = await match([], {});
  assert.equal(result.kind, "none");
});

test("a reply's status follows the booking it answers", () => {
  assert.equal(
    tradieReplyStatus(TradieScheduleStatus.PENDING_FINAL_CONFIRMATION, true),
    TradieScheduleStatus.CONFIRMED,
  );
  assert.equal(
    tradieReplyStatus(TradieScheduleStatus.PENDING_RESPONSE, true),
    TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
  );
  assert.equal(
    tradieReplyStatus(TradieScheduleStatus.PENDING_RESPONSE, false),
    TradieScheduleStatus.DECLINED,
  );
});

// ---------------------------------------------------------------------------
// References: "[RCTRQ-…]" on a request email, "[RCTBK-…]" on one booking
// ---------------------------------------------------------------------------

test("a reference is found in a mangled subject, or in the body when the subject lost it", () => {
  assert.equal(
    extractTradieRefToken(
      "RE: re: booking – please confirm [rctrq-0a1b2c3d4e5f]",
      "",
    ),
    "RCTRQ-0A1B2C3D4E5F",
  );
  assert.equal(
    extractTradieRefToken("Quote for Wheat St", "Our ref RCTBK-AABBCCDDEEFF"),
    "RCTBK-AABBCCDDEEFF",
  );
  // The subject wins over an older thread quoted in the body.
  assert.equal(
    extractTradieRefToken(
      "Re: x [RCTBK-111111111111]",
      "> [RCTRQ-222222222222]",
    ),
    "RCTBK-111111111111",
  );
  assert.equal(extractTradieRefToken("Re: [RCCERT-0A1B2C3D4E5F]", ""), null);
  assert.equal(
    subjectWithTradieRef("Booking – Wheat St", "RCTRQ-0A1B2C3D4E5F"),
    "Booking – Wheat St [RCTRQ-0A1B2C3D4E5F]",
  );
  // Once, even when the office left it on.
  assert.equal(
    subjectWithTradieRef("Booking [rctrq-0a1b2c3d4e5f]", "RCTRQ-0A1B2C3D4E5F"),
    "Booking [rctrq-0a1b2c3d4e5f]",
  );
});

const ABC = {
  additionalEmails: ["Office@ABC.example"],
  email: "quotes@abc.example",
  id: "t_abc",
  name: "ABC Plumbing",
};

test("a request reference names that email's bookings; a booking reference names one", async () => {
  const request = await findTradieReplyReference(
    "RCTRQ-0A1B2C3D4E5F",
    recordingDb({
      "tradieRequestRecipient.findUnique": {
        id: "r_1",
        request: { project: { name: "11 Wheat Street" } },
        tradie: ABC,
      },
    }).db,
  );
  assert.deepEqual(request?.scope, { requestRecipientId: "r_1" });
  assert.equal(request?.projectName, "11 Wheat Street");

  const booking = await findTradieReplyReference(
    "RCTBK-0A1B2C3D4E5F",
    recordingDb({
      "tradieSchedule.findUnique": {
        id: "s_1",
        project: { name: "11 Wheat Street" },
        tradie: ABC,
      },
    }).db,
  );
  assert.deepEqual(booking?.scope, { scheduleId: "s_1" });

  // Nothing behind it: the caller falls back to matching on the sender.
  assert.equal(
    await findTradieReplyReference(
      "RCTBK-0A1B2C3D4E5F",
      recordingDb({ "tradieSchedule.findUnique": null }).db,
    ),
    null,
  );
});

test("a referenced reply counts only from an address the tradie is on file with", () => {
  const reference = { tradie: ABC };
  assert.ok(isReplyFromTradie(reference, "quotes@abc.example"));
  assert.ok(isReplyFromTradie(reference, " office@abc.example "));
  assert.ok(!isReplyFromTradie(reference, "someone@else.example"));
  assert.ok(!isReplyFromTradie(reference, ""));
});

test("a reference narrows the match to the bookings it names", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findMany": [booking("s_1", "2026-10-12", ORION)],
  });
  await matchTradieReplyToSchedule(
    {
      hints: {},
      scope: { requestRecipientId: "r_1" },
      tradieId: "t_1",
    },
    recorder.db,
  );
  const where = (recorder.calls[0]?.args as { where: Record<string, unknown> })
    .where;
  assert.equal(where.requestRecipientId, "r_1");
  assert.equal(where.tradieId, "t_1");
});

test("a reply to several referenced bookings applies to all only when it means the same for each", () => {
  const direct = [
    booking("s_1", "2026-10-12", ORION),
    booking("s_2", "2026-10-20", ORION),
  ];
  const quoting = direct.map((row) => ({
    ...row,
    status: TradieScheduleStatus.AWAITING_QUOTE,
  }));

  // Turning the email down turns down every booking on it.
  assert.equal(
    referencedReplyTargets(quoting, { confirmed: false, quoted: false }),
    quoting,
  );
  // A yes to a booking email confirms the dates it listed.
  assert.equal(
    referencedReplyTargets(direct, { confirmed: true, quoted: false }),
    direct,
  );
  // A price cannot be split by a guess.
  assert.equal(
    referencedReplyTargets(direct, { confirmed: true, quoted: true }),
    null,
  );
  // A yes with no price to a quote request is not an answer to it.
  assert.equal(
    referencedReplyTargets(quoting, { confirmed: true, quoted: false }),
    null,
  );
});

test("the Graph webhook matches a referenced reply before falling back to the sender", () => {
  const route = readFileSync(
    join(REPO_ROOT, "app/api/graph/notifications/route.ts"),
    "utf8",
  );
  const referenced = route.indexOf("findTradieReplyReference(");
  const bySender = route.indexOf("isTradieMessage(message.from)");
  assert.ok(referenced > 0 && bySender > referenced);
  assert.match(route, /isReplyFromTradie\(/);
  // A reply to a request email that also covers cancelled or declined work
  // goes to the office: the tradie was never told it is off.
  assert.match(
    route,
    /requestRecipientId: reference\.scope\.requestRecipientId,\s*status: \{\s*in: \[TradieScheduleStatus\.CANCELLED, TradieScheduleStatus\.DECLINED\]/,
  );
});

test("the Graph webhook applies a reply as the system, not through the browser's Server Action", () => {
  const route = readFileSync(
    join(REPO_ROOT, "app/api/graph/notifications/route.ts"),
    "utf8",
  );
  assert.match(route, /matchTradieReplyToSchedule\(/);
  assert.match(route, /applyTradieScheduleUpdate\(\s*systemPrincipal\(/);
  assert.doesNotMatch(route, /updateTradieSchedule\(/);
  assert.doesNotMatch(route, /new Date\(tradieInfo\.scheduleDate\)/);

  // The principal-taking half must not be reachable from a browser.
  const updates = readFileSync(
    join(REPO_ROOT, "lib/data/tradie-schedule-updates.ts"),
    "utf8",
  );
  assert.match(updates, /^import "server-only";/);
  assert.doesNotMatch(updates, /^["']use server["']/m);
});
