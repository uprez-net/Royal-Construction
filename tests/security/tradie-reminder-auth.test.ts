import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

// sendTradieScheduleReminder is a Server Action the schedule screens import, so
// its id ships to the browser. It took { to, subject, body } and checked
// nobody: any signed-in user, a customer included, could have Royal's Graph
// mailbox send any message to any address. The module loads Prisma, Clerk and
// Graph, so this reads the source.
//
// The rule now lives in two places on purpose (issue #301): the Server Action
// refuses a caller who is not internal staff before it does anything, and the
// domain command in lib/domain/tradies/reminders.ts resolves the recipient off
// the stored schedule. Eve and any future caller get the recipient rule by
// calling that command, so this checks both halves.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const schedules = read("lib/data/tradieSchedules.ts");
const reminders = read("lib/domain/tradies/reminders.ts");
const modal = read("components/tradies/reminder-send-modal.tsx");

function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  const bodyStart = source.indexOf(") {", start);
  assert.ok(bodyStart > start, `${signature} has no body`);
  const end = source.indexOf("\n}", bodyStart);
  assert.ok(end > start, `${signature} has no end`);
  return source.slice(start, end);
}

const actionBody = () =>
  bodyOf(schedules, "export async function sendTradieScheduleReminder(");
const commandBody = () =>
  bodyOf(reminders, "export async function sendTradieScheduleReminder(");

test("the reminder checks the caller is staff before it looks anything up or sends", () => {
  const body = actionBody();
  const check = body.indexOf("await requireStaffUser()");
  assert.ok(check >= 0, "sendTradieScheduleReminder never checks its caller");
  assert.match(
    body,
    /if \(!access\.ok\) \{\s*return \{ success: false, message: access\.error \};/,
  );
  assert.ok(
    check < body.indexOf("sendTradieScheduleReminderDomain("),
    "the domain command runs before the caller is checked",
  );

  // The command refuses a non-staff principal too, so Eve and the cron cannot
  // route around the action's guard.
  assert.match(commandBody(), /isInternalPrincipal\(principal\)/);
});

test("the reminder goes to the schedule's tradie, never an address from the browser", () => {
  const normalizedAction = actionBody().replace(/\s+/g, " ");
  assert.match(
    normalizedAction,
    /\{\s*scheduleId,\s*subject,\s*body,?\s*\}\s*:\s*\{\s*scheduleId: string;\s*subject: string;\s*body: string;?\s*\}/,
  );
  assert.doesNotMatch(actionBody(), /\bto: string\b/);

  // The one place the recipient is resolved: off the stored schedule.
  const command = commandBody();
  assert.match(command, /const to = schedule\.tradie\.email\.trim\(\);/);
  assert.doesNotMatch(command, /input\.to\b/);
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
