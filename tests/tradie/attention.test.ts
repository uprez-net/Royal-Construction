import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import {
  tradieAttention,
  tradieAttentionItems,
  type AttentionBooking,
} from "@/lib/domain/tradies/attention";
import { REPO_ROOT } from "../support/repo-root";

// One answer to "which tradie bookings need somebody, and which button deals
// with it", for both the project Alerts card and the Tradies tab. They used to
// disagree: the Alerts card offered a reminder to a tradie who had already
// confirmed, and the tab's one "Review" button could not book a replacement
// for a tradie who had declined.

const NOW = new Date("2026-10-14T01:00:00.000Z");
const TODAY = "2026-10-14";

function booking(
  overrides: Partial<AttentionBooking> & { status: TradieScheduleStatus },
): AttentionBooking {
  return {
    durationDays: 1,
    id: "s_1",
    milestone: { status: MilestoneStatus.ACTIVE },
    milestoneId: "m_1",
    reminderSentAt: null,
    scheduledDate: "2026-10-18T00:00:00.000Z",
    tradie: { trade: "Electrician" },
    ...overrides,
  };
}

const attentionOf = (b: AttentionBooking) =>
  tradieAttention(b, [b], TODAY, NOW);

test("each status gets the one control that deals with it", () => {
  assert.deepEqual(
    attentionOf(booking({ status: TradieScheduleStatus.NO_RESPONSE })),
    { action: "remind", kind: "no-response", tone: "danger" },
  );
  assert.deepEqual(
    attentionOf(booking({ status: TradieScheduleStatus.DECLINED })),
    { action: "replace", kind: "declined", tone: "danger" },
  );
  assert.deepEqual(
    attentionOf(booking({ status: TradieScheduleStatus.CANCELLED })),
    { action: "replace", kind: "removed", tone: "danger" },
  );
  assert.deepEqual(
    attentionOf(
      booking({ status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION }),
    ),
    { action: "remind", kind: "final-confirmation", tone: "warning" },
  );
  assert.deepEqual(
    attentionOf(
      booking({ status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL }),
    ),
    { action: "approve", kind: "admin-approval", tone: "warning" },
  );
  assert.deepEqual(
    attentionOf(booking({ status: TradieScheduleStatus.PENDING })),
    { action: "remind", kind: "follow-up", tone: "warning" },
  );
});

test("a confirmed tradie is not offered a reminder", () => {
  assert.equal(
    attentionOf(booking({ status: TradieScheduleStatus.CONFIRMED })),
    null,
  );
});

test("a tradie waiting on an admin is never chased, however stale the reminder", () => {
  assert.equal(
    attentionOf(
      booking({
        reminderSentAt: "2026-09-01T00:00:00.000Z",
        scheduledDate: "2026-11-20T00:00:00.000Z",
        status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
      }),
    ),
    null,
  );
});

test("a booking far off and recently reminded needs nothing yet", () => {
  assert.equal(
    attentionOf(
      booking({
        reminderSentAt: "2026-10-13T00:00:00.000Z",
        scheduledDate: "2026-11-20T00:00:00.000Z",
        status: TradieScheduleStatus.PENDING_RESPONSE,
      }),
    ),
    null,
  );
});

test("a dismissed alert stays dismissed while its booking holds still", () => {
  assert.equal(
    attentionOf(
      booking({
        alertDismissedStatus: TradieScheduleStatus.NO_RESPONSE,
        status: TradieScheduleStatus.NO_RESPONSE,
      }),
    ),
    null,
  );
});

test("the list leads with what is going wrong, then the soonest", () => {
  const items = tradieAttentionItems(
    [
      booking({
        id: "later_warning",
        scheduledDate: "2026-10-19T00:00:00.000Z",
        status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
      }),
      booking({
        id: "sooner_warning",
        scheduledDate: "2026-10-15T00:00:00.000Z",
        status: TradieScheduleStatus.PENDING_FINAL_CONFIRMATION,
      }),
      booking({
        id: "danger",
        milestoneId: "m_2",
        scheduledDate: "2026-10-20T00:00:00.000Z",
        status: TradieScheduleStatus.NO_RESPONSE,
      }),
    ],
    TODAY,
    NOW,
  );
  assert.deepEqual(
    items.map((item) => item.booking.id),
    ["danger", "sooner_warning", "later_warning"],
  );
});

test("both project surfaces render from the shared rule, not their own", () => {
  const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
  for (const path of [
    "components/projects/detail/project-alerts.tsx",
    "components/projects/detail/project-tradies-tab.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /useTradieAttention\(/, path);
    // Deciding liveness or status-by-status wording locally is how the two
    // drifted apart.
    assert.doesNotMatch(source, /isTradieAlertLive/, path);
  }
  const card = read("components/projects/detail/tradie-attention-card.tsx");
  assert.match(card, /<TradieAttentionActionButton/);
  const alerts = read("components/projects/detail/project-alerts.tsx");
  assert.match(alerts, /<TradieAttentionActionButton/);
});
