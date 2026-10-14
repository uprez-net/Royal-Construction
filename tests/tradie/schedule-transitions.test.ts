import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import { tradieReplyStatus } from "@/lib/domain/tradies/replies";
import { canTransitionSchedule } from "@/lib/domain/tradies/schedule-transitions";
import { REPO_ROOT } from "../support/repo-root";

// The status modal and the transition command each had their own table, and
// they disagreed about AWAITING_QUOTE: every option the modal offered came
// back 409, and so did a tradie's emailed quote.

test("a tradie's reply to a quote booking is an edge the command allows", () => {
  for (const status of [
    TradieScheduleStatus.AWAITING_QUOTE,
    TradieScheduleStatus.QUOTE_RECEIVED,
  ]) {
    for (const confirmed of [true, false]) {
      const to = tradieReplyStatus(status, confirmed);
      assert.ok(
        canTransitionSchedule(status, to),
        `${status} -> ${to} is refused`,
      );
    }
  }
});

test("the status modal reads the command's table instead of keeping its own", () => {
  const modal = readFileSync(
    join(REPO_ROOT, "components/tradies/confirm-status-modal.tsx"),
    "utf8",
  );
  assert.match(modal, /canTransitionSchedule\(/);
  assert.doesNotMatch(modal, /TRADIE_SCHEDULE_STATE_MACHINE/);
});
