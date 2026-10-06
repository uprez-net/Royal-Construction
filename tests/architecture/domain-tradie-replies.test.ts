import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import {
  AWAITING_TRADIE_REPLY,
  matchTradieReplyToSchedule,
  tradieReplyStatus,
} from "@/lib/domain/tradies/replies";
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
