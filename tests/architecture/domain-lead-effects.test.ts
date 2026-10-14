import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OutboxEventStatus } from "@prisma/client";
import { test } from "vitest";

import {
  bookConsultation,
  consultationBookingKey,
} from "@/lib/domain/leads/booking";
import {
  allowedLeadRecipients,
  authorizeLeadEmail,
  sendLeadEmailOnce,
} from "@/lib/domain/leads/email";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { ROOT } from "./module-graph";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "./domain-harness";

// Phase 2's remaining external effects: the public booking form and the lead
// email composer. Both reach a client, and neither was durable.

const read = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

function pendingIntent() {
  return {
    "outboxEvent.upsert": (args: unknown) => ({
      id: "effect_1",
      key: (args as { where: { key: string } }).where.key,
      result: null,
      status: OutboxEventStatus.PENDING,
    }),
    "outboxEvent.findUnique": (args: unknown) => ({
      attempts: 0,
      id: "effect_1",
      key: (args as { where: { key: string } }).where.key,
      kind: "CONSULTATION_BOOKING",
      payload: {},
      status: OutboxEventStatus.PENDING,
    }),
    "outboxEvent.updateMany": { count: 1 },
  };
}

/* ------------------------------------------------ the public booking -- */

test("a booking is identified by its slot and the client who asked", () => {
  const slot = {
    email: "  Client@Example.com ",
    name: "Client",
    startsAt: new Date("2026-10-01T04:00:00.000Z"),
  };
  assert.equal(
    consultationBookingKey(slot),
    "consultation:2026-10-01T04:00:00.000Z:client@example.com",
  );
  // A different time is a different consultation, not a duplicate.
  assert.notEqual(
    consultationBookingKey(slot),
    consultationBookingKey({
      ...slot,
      startsAt: new Date("2026-10-02T04:00:00.000Z"),
    }),
  );
});

test("a booking with no email or an unreadable time is refused", () => {
  assert.throws(
    () =>
      consultationBookingKey({
        email: "   ",
        name: "Client",
        startsAt: new Date("2026-10-01T04:00:00.000Z"),
      }),
    DomainValidationError,
  );
  assert.throws(
    () =>
      consultationBookingKey({
        email: "client@example.com",
        name: "Client",
        startsAt: new Date("not a date"),
      }),
    DomainValidationError,
  );
});

test("resubmitting the same booking does not make a second meeting", async () => {
  let calendarCalls = 0;
  const slot = {
    email: "client@example.com",
    name: "Client",
    startsAt: new Date("2026-10-01T04:00:00.000Z"),
  };

  const first = await bookConsultation(
    customerPrincipal(),
    slot,
    recordingDb(pendingIntent()).transactionalDb,
    async () => {
      calendarCalls += 1;
      return {
        confirmationSent: true,
        joinUrl: "https://teams.example/1",
        leadId: 7,
      };
    },
  );
  assert.deepEqual(first, {
    alreadyBooked: false,
    confirmationSent: true,
    joinUrl: "https://teams.example/1",
    leadId: 7,
  });

  // The double-click. The calendar conflict check cannot catch this on its own
  // because both requests can pass it before either event exists.
  const second = await bookConsultation(
    customerPrincipal(),
    slot,
    recordingDb({
      "outboxEvent.upsert": {
        id: "effect_1",
        key: consultationBookingKey(slot),
        result: { joinUrl: "https://teams.example/1", leadId: 7 },
        status: OutboxEventStatus.SUCCEEDED,
      },
    }).transactionalDb,
    async () => {
      calendarCalls += 1;
      return {
        confirmationSent: true,
        joinUrl: "https://teams.example/2",
        leadId: 9,
      };
    },
  );
  assert.equal(second.alreadyBooked, true);
  // The client is handed the meeting they already have, not a second one.
  assert.equal(second.joinUrl, "https://teams.example/1");
  assert.equal(calendarCalls, 1);
  // That stored result predates confirmationSent. Every booking then was an
  // online one, confirmed by its Teams invitation, so absent means sent.
  assert.equal(second.confirmationSent, true);
});

test("an in-person booking whose confirmation email failed says so", async () => {
  const booked = await bookConsultation(
    customerPrincipal(),
    {
      email: "client@example.com",
      name: "Client",
      startsAt: new Date("2026-10-02T04:00:00.000Z"),
    },
    recordingDb(pendingIntent()).transactionalDb,
    async () => ({ confirmationSent: false, joinUrl: null, leadId: 7 }),
  );
  // Reported, not swallowed: the page tells the client, and the meeting task
  // tells the office, that nobody has the venue yet.
  assert.equal(booked.confirmationSent, false);
  assert.equal(booked.alreadyBooked, false);
});

test("the booking route commits the meeting and the lead together", () => {
  const route = read("app/api/graph/book-consultant/route.ts");
  // The Graph create and upsertBookingNotes are inside the one intent, so a
  // client cannot be left holding an invitation the office has no record of.
  const intent = route.indexOf("await bookConsultation(");
  assert.ok(intent >= 0, "the booking does not go through the shared command");
  const body = route.slice(intent, route.indexOf("} catch (bookingError)"));
  assert.match(body, /graph\.microsoft\.com/);
  assert.match(body, /upsertBookingNotes\(/);
});

/* -------------------------------------------------- the lead composer -- */

const LEAD = {
  assignedId: null as string | null,
  email: "client@example.com",
  id: 7,
  name: "Ann Lee",
  secondaryEmail: "partner@example.com",
};

test("a lead email may only reach an address on the lead", async () => {
  const recorder = recordingDb({ "lead.findUnique": LEAD });
  assert.deepEqual(
    await authorizeLeadEmail(
      adminPrincipal(),
      { leadId: 7, to: " Client@Example.com " },
      recorder.db,
    ),
    { leadId: 7, leadName: "Ann Lee", to: "client@example.com" },
  );

  // The secondary contact counts; anything else does not. `to` came straight
  // from the browser, so without this the composer was a way to send an
  // arbitrary body to an arbitrary address from Royal's mailbox.
  assert.equal(
    (
      await authorizeLeadEmail(
        adminPrincipal(),
        { leadId: 7, to: "partner@example.com" },
        recordingDb({ "lead.findUnique": LEAD }).db,
      )
    ).to,
    "partner@example.com",
  );
  await assert.rejects(
    () =>
      authorizeLeadEmail(
        adminPrincipal(),
        { leadId: 7, to: "somebody.else@example.com" },
        recordingDb({ "lead.findUnique": LEAD }).db,
      ),
    DomainAuthorizationError,
  );
});

test("emailing a lead is staff-only, even the lead's own customer", async () => {
  const principal = customerPrincipal();
  assert.equal(principal.kind, "user");
  await assert.rejects(
    () =>
      authorizeLeadEmail(
        principal,
        { leadId: 7, to: "client@example.com" },
        recordingDb({
          "lead.findUnique": {
            ...LEAD,
            assignedId: principal.kind === "user" ? principal.userId : null,
          },
        }).db,
      ),
    DomainAuthorizationError,
  );
});

test("a missing lead and a blank recipient are told apart", async () => {
  await assert.rejects(
    () =>
      authorizeLeadEmail(
        adminPrincipal(),
        { leadId: 7, to: "client@example.com" },
        recordingDb({ "lead.findUnique": null }).db,
      ),
    DomainNotFoundError,
  );
  await assert.rejects(
    () =>
      authorizeLeadEmail(
        adminPrincipal(),
        { leadId: 7, to: "   " },
        recordingDb({ "lead.findUnique": LEAD }).db,
      ),
    DomainValidationError,
  );
});

test("a lead with no addresses can be emailed nowhere", () => {
  assert.deepEqual(
    allowedLeadRecipients({ email: "  ", secondaryEmail: null }),
    [],
  );
});

test("pressing Send twice on the same message sends it once", async () => {
  const authorized = {
    leadId: 7,
    leadName: "Ann Lee",
    to: "client@example.com",
  };
  let sends = 0;
  const first = await sendLeadEmailOnce(
    authorized,
    { bodyFingerprint: "abc", now: new Date("2026-09-21T09:00:00.000Z") },
    recordingDb({
      ...pendingIntent(),
      "outboxEvent.findUnique": {
        attempts: 0,
        id: "effect_1",
        key: "lead-email:2026-09-21:7:client@example.com:abc",
        kind: "LEAD_EMAIL_SEND",
        payload: {},
        status: OutboxEventStatus.PENDING,
      },
    }).db,
    async () => {
      sends += 1;
      return { emailId: "email_1" };
    },
  );
  assert.deepEqual(first, {
    alreadySent: false,
    result: { emailId: "email_1" },
  });

  const replay = await sendLeadEmailOnce(
    authorized,
    { bodyFingerprint: "abc", now: new Date("2026-09-21T16:00:00.000Z") },
    recordingDb({
      "outboxEvent.upsert": {
        id: "effect_1",
        key: "lead-email:2026-09-21:7:client@example.com:abc",
        result: { emailId: "email_1" },
        status: OutboxEventStatus.SUCCEEDED,
      },
    }).db,
    async () => {
      sends += 1;
      return { emailId: "email_2" };
    },
  );
  assert.equal(replay.alreadySent, true);
  assert.equal(replay.result.emailId, "email_1");
  assert.equal(sends, 1);
});

test("a genuinely new message still goes out", async () => {
  const keys: string[] = [];
  const script = {
    ...pendingIntent(),
    "outboxEvent.upsert": (args: unknown) => {
      const key = (args as { where: { key: string } }).where.key;
      keys.push(key);
      return {
        id: "effect_1",
        key,
        result: null,
        status: OutboxEventStatus.PENDING,
      };
    },
  };
  const authorized = {
    leadId: 7,
    leadName: "Ann Lee",
    to: "client@example.com",
  };
  for (const bodyFingerprint of ["abc", "def"]) {
    await sendLeadEmailOnce(
      authorized,
      { bodyFingerprint, now: new Date("2026-09-21T09:00:00.000Z") },
      recordingDb(script).db,
      async () => ({ emailId: "email_1" }),
    );
  }
  assert.notEqual(keys[0], keys[1]);

  // And the same short message next week is not a duplicate of this one.
  await sendLeadEmailOnce(
    authorized,
    { bodyFingerprint: "abc", now: new Date("2026-09-28T09:00:00.000Z") },
    recordingDb(script).db,
    async () => ({ emailId: "email_1" }),
  );
  assert.notEqual(keys[0], keys[2]);
});

test("the composer action reaches the shared rules", () => {
  const adapter = read("lib/data/leads.ts");
  assert.match(adapter, /authorizeLeadEmail\(/);
  assert.match(adapter, /sendLeadEmailOnce\(/);
  // Its own "is the caller signed in" check, which said nothing about the
  // lead or the recipient, is gone.
  assert.doesNotMatch(
    adapter,
    /throw new Error\("Authenticated user not found"\)/,
  );
});
