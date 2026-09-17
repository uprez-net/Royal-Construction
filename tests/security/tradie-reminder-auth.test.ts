import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// sendTradieScheduleReminder is a Server Action the schedule screens import, so
// its id ships to the browser. It took { to, subject, body } and checked
// nobody: any signed-in user, a customer included, could have Royal's Graph
// mailbox send any message to any address. The module loads Prisma, Clerk and
// Graph, so this reads the source.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const schedules = read("lib/data/tradieSchedules.ts");
const modal = read("components/tradies/reminder-send-modal.tsx");

function reminderBody(): string {
  const start = schedules.indexOf(
    "export async function sendTradieScheduleReminder(",
  );
  assert.ok(start >= 0, "sendTradieScheduleReminder not found");
  const end = schedules.indexOf("\n}", start);
  assert.ok(end > start, "sendTradieScheduleReminder has no end");
  return schedules.slice(start, end);
}

test("the reminder checks the caller is staff before it looks anything up or sends", () => {
  const body = reminderBody();
  const check = body.indexOf("await requireInternalUser()");
  assert.ok(check >= 0, "sendTradieScheduleReminder never checks its caller");
  assert.match(
    body,
    /if \(!access\.ok\) \{\s*return \{ success: false, message: access\.error \};/,
  );
  assert.ok(
    check < body.indexOf("prisma.tradieSchedule.findUnique("),
    "the schedule is read before the caller is checked",
  );
  assert.ok(
    check < body.indexOf("sendEmail("),
    "the email is sent before the caller is checked",
  );
});

test("the reminder goes to the schedule's tradie, never an address from the browser", () => {
  const body = reminderBody();
  assert.match(
    body,
    /\{ scheduleId, subject, body \}: \{ scheduleId: string; subject: string; body: string \}/,
  );
  assert.match(body, /const to = schedule\.tradie\.email\.trim\(\);/);
  assert.doesNotMatch(body, /\bto: string\b/);
});

test("the reminder modal sends the schedule id and shows a refusal", () => {
  assert.match(
    modal,
    /sendTradieScheduleReminder\(\{\s*scheduleId: schedule\.id,/,
  );
  assert.doesNotMatch(modal, /to: tradie\.email/);
  assert.match(
    modal,
    /if \(!result\.success\) \{\s*toast\.error\(result\.message\);\s*return;/,
  );
});
