import assert from "node:assert/strict";

import { test } from "vitest";

import type { TradieScheduleListItem } from "@/types/project";
import {
  generateTradieOutreachEmail,
  generateTradieReminderEmail,
  generateTradieRescheduleEmail,
} from "@/utils/generate-email";

// What a tradie reads about a booking. These go outside the office, so a
// wrong promise in one ("your booking is approved" on one that is not) is the
// expensive kind of mistake.

const SCHEDULE: TradieScheduleListItem = {
  abn: "1",
  contact: { additionalEmails: [], email: "sam@example.com", phone: "0400" },
  durationDays: 2,
  id: "s_1",
  isFavourite: false,
  lastQuotedPriceUnit: "HOURLY",
  milestoneName: "Framing",
  note: null,
  projectId: "p_1",
  projectName: "Smith Residence",
  requiresQuote: false,
  scheduledDate: "2026-10-21T00:00:00.000Z",
  siteManager: { email: "jo@example.com", name: "Jo", phone: "0411" },
  status: "PENDING",
  taskLabel: "Framing",
  tradeType: "Electrician",
  tradieId: "t_1",
  tradieName: "Sam Sparks",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const PREVIOUS = {
  durationDays: 2,
  scheduledDate: "2026-10-20T00:00:00.000Z",
};

test("an approved reschedule says it is still approved and asks only to confirm", () => {
  const email = generateTradieRescheduleEmail(
    { ...SCHEDULE, status: "CONFIRMED" },
    PREVIOUS,
    "reconfirm-attendance",
  );
  assert.match(email.subject, /please confirm/i);
  assert.match(email.html, /remains approved/);
  assert.match(email.html, /<strong>confirmed<\/strong>/);
  assert.match(email.html, /Previous Date/);
  assert.match(email.html, /New Date/);
  assert.doesNotMatch(email.html, /confirm your availability/);
});

test("an unapproved reschedule reads as a follow-up asking for availability", () => {
  const email = generateTradieRescheduleEmail(
    SCHEDULE,
    PREVIOUS,
    "confirm-availability",
  );
  assert.match(email.subject, /availability confirmation required/i);
  assert.match(email.html, /following up on our earlier request/);
  assert.match(email.html, /confirm your availability for the new date/);
  assert.doesNotMatch(email.html, /remains approved/);
});

test("a changed duration is called out next to the old one", () => {
  const email = generateTradieRescheduleEmail(
    { ...SCHEDULE, durationDays: 3 },
    PREVIOUS,
    "confirm-availability",
  );
  assert.match(email.html, /3 days<\/strong> \(previously 2 days\)/);
});

test("the reminder asks for what the booking is actually waiting on", () => {
  assert.match(
    generateTradieReminderEmail({ ...SCHEDULE, status: "CONFIRMED" }).html,
    /approved booking/,
  );
  assert.match(
    generateTradieReminderEmail({ ...SCHEDULE, status: "AWAITING_QUOTE" })
      .subject,
    /Quotation reminder/,
  );
  assert.match(
    generateTradieReminderEmail({ ...SCHEDULE, status: "NO_RESPONSE" }).subject,
    /Availability reminder/,
  );
});

test("names are escaped and the sent email is not editable", () => {
  const email = generateTradieReminderEmail({
    ...SCHEDULE,
    projectName: "Lot 5 <Stage 2>",
    tradieName: "O'Brien & Sons",
  });
  assert.match(email.html, /O&#39;Brien &amp; Sons/);
  assert.match(email.html, /Lot 5 &lt;Stage 2&gt;/);
  for (const html of [email.html, generateTradieOutreachEmail(SCHEDULE).html]) {
    assert.doesNotMatch(html, /contenteditable/);
  }
});

test("a project with no site manager prints no empty site manager panel", () => {
  const email = generateTradieReminderEmail({
    ...SCHEDULE,
    siteManager: { email: "", name: "Unassigned", phone: "" },
  });
  assert.doesNotMatch(email.html, />\s*Site Manager\s*</);
  assert.doesNotMatch(email.html, /Unassigned/);
});

test("every email about a booking carries its reference, on the subject and in a reply note", () => {
  const referenced = { ...SCHEDULE, refToken: "RCTBK-0A1B2C3D4E5F" };
  for (const email of [
    generateTradieOutreachEmail(referenced),
    generateTradieReminderEmail(referenced),
    generateTradieRescheduleEmail(referenced, PREVIOUS, "confirm-availability"),
  ]) {
    assert.match(email.subject, /\[RCTBK-0A1B2C3D4E5F\]$/);
    assert.match(email.html, /Our reference: <strong[^>]*>RCTBK-0A1B2C3D4E5F/);
    assert.match(email.html, /reply directly to this email/);
  }
  // A booking from before references existed still renders, without one.
  assert.doesNotMatch(
    generateTradieReminderEmail(SCHEDULE).html,
    /Our reference/,
  );
});
