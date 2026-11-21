import assert from "node:assert/strict";
import { InvoiceStatus, TradieScheduleStatus } from "@prisma/client";
import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  prepareTradieInvoiceRecheck,
  requestTradieInvoiceRecheck,
} from "@/lib/domain/tradies/invoice-recheck";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// "Request recheck" emails a tradie whose invoices on a booking come to more
// than its approved quote. It goes to a person outside the office, so it must
// only go when the figures say so, must quote only the tradie's own figures,
// and must not go twice for one press.

const PROJECT = {
  id: "project-1",
  location: "1 Site St",
  name: "Smith build",
  siteManagerId: null,
};

/** Read by both the recheck and the reminder send it goes out through. */
const OVER_INVOICED = {
  durationDays: 3,
  id: "schedule-1",
  invoices: [
    {
      invoiceNumber: "ACE-101",
      issuedDate: new Date("2026-11-01T00:00:00.000Z"),
      status: InvoiceStatus.AUTHORISED,
      subTotal: "3000.00",
    },
    {
      invoiceNumber: "ACE-102",
      issuedDate: new Date("2026-11-15T00:00:00.000Z"),
      status: InvoiceStatus.AUTHORISED,
      subTotal: "1500.00",
    },
    {
      invoiceNumber: "ACE-099",
      issuedDate: new Date("2026-10-20T00:00:00.000Z"),
      status: InvoiceStatus.VOIDED,
      subTotal: "9999.00",
    },
  ],
  milestone: { name: "Frame carpentry" },
  milestoneId: "milestone-1",
  project: {
    name: PROJECT.name,
    siteManager: { email: "sam@royal.example", name: "Sam", phone: "0400" },
  },
  projectId: PROJECT.id,
  quote: { gstTreatment: "EXCLUSIVE" },
  quotedPrice: "4000.00",
  refToken: "RCTBK-0123456789AB",
  requiresQuote: true,
  status: TradieScheduleStatus.CONFIRMED,
  trade: "Carpentry",
  tradie: {
    archivedAt: null,
    email: " ace@example.com ",
    lastQuotedPrice: null,
    lastQuotedPriceUnit: "FIXED",
    name: "Ace Carpentry",
    trade: "Carpentry",
  },
  tradieId: "tradie-1",
};

function outbox() {
  return {
    "outboxEvent.findUnique": {
      attempts: 0,
      id: "event-1",
      key: "k",
      kind: "TRADIE_SCHEDULE_MANUAL_REMINDER",
      payload: {},
      status: "PENDING",
    },
    "outboxEvent.updateMany": { count: 1 },
    "outboxEvent.upsert": {
      id: "event-1",
      key: "k",
      result: null,
      status: "PENDING",
    },
  };
}

describe("prepareTradieInvoiceRecheck", () => {
  test("is admin only, and reads nothing for anyone else", async () => {
    const recorder = recordingDb();
    await assert.rejects(
      prepareTradieInvoiceRecheck(
        siteManagerPrincipal(),
        { projectId: PROJECT.id, scheduleId: "schedule-1" },
        recorder.db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.calls, []);
  });

  test("the email quotes the tradie's own figures, counted invoices only", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieSchedule.findUnique": OVER_INVOICED,
    });
    const recheck = await prepareTradieInvoiceRecheck(
      adminPrincipal(),
      { projectId: PROJECT.id, scheduleId: "schedule-1" },
      recorder.db,
    );
    assert.equal(recheck.to, "ace@example.com");
    assert.match(recheck.subject, /Invoice query/);
    assert.match(recheck.subject, /\[RCTBK-0123456789AB\]$/);
    // Money is wrapped in a monospace span, so read the words a person reads.
    const text = recheck.html.replace(/<[^>]+>/g, "");
    assert.match(text, /\$4,000\.00 ex GST/);
    assert.match(text, /\$4,500\.00/);
    assert.match(text, /\$500\.00 over the approved quote/);
    assert.match(recheck.html, /ACE-101/);
    assert.match(recheck.html, /ACE-102/);
    // A voided invoice is withdrawn: not listed, not counted.
    assert.doesNotMatch(recheck.html, /ACE-099/);
    assert.doesNotMatch(recheck.html, /9,999/);
    assert.deepEqual(recorder.writes(), []);
  });

  test("a quote silent on GST is given as quoted, not claimed as ex GST", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieSchedule.findUnique": { ...OVER_INVOICED, quote: null },
    });
    const recheck = await prepareTradieInvoiceRecheck(
      adminPrincipal(),
      { projectId: PROJECT.id, scheduleId: "schedule-1" },
      recorder.db,
    );
    assert.match(
      recheck.html.replace(/<[^>]+>/g, ""),
      /\$4,000\.00 \(as quoted\)/,
    );
  });

  test("refuses a booking whose invoices are within its quote", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieSchedule.findUnique": {
        ...OVER_INVOICED,
        quotedPrice: "5000.00",
      },
    });
    await assert.rejects(
      prepareTradieInvoiceRecheck(
        adminPrincipal(),
        { projectId: PROJECT.id, scheduleId: "schedule-1" },
        recorder.db,
      ),
      DomainTransitionError,
    );
  });

  test("refuses a price that is only our estimate from the tradie's rate", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieSchedule.findUnique": {
        ...OVER_INVOICED,
        quotedPrice: null,
        requiresQuote: false,
        tradie: {
          ...OVER_INVOICED.tradie,
          lastQuotedPrice: "1000",
          lastQuotedPriceUnit: "FIXED",
        },
      },
    });
    await assert.rejects(
      prepareTradieInvoiceRecheck(
        adminPrincipal(),
        { projectId: PROJECT.id, scheduleId: "schedule-1" },
        recorder.db,
      ),
      DomainValidationError,
    );
  });
});

describe("requestTradieInvoiceRecheck", () => {
  test("sends once to the tradie through the booking email, and logs it", async () => {
    const sent: { to: string; subject: string }[] = [];
    const recorder = recordingDb({
      ...outbox(),
      "project.findUnique": PROJECT,
      "tradieSchedule.findUnique": OVER_INVOICED,
    });
    const result = await requestTradieInvoiceRecheck(
      adminPrincipal(),
      {
        attemptKey: "attempt-1",
        projectId: PROJECT.id,
        scheduleId: "schedule-1",
      },
      recorder.db,
      async (message) => {
        sent.push(message);
      },
    );
    assert.deepEqual(result, { alreadySent: false, to: "ace@example.com" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "ace@example.com");
    const upsert = recorder
      .writes()
      .find((call) => call.operation === "outboxEvent.upsert");
    const key = (upsert?.args as { where: { key: string } }).where.key;
    assert.match(key, /invoice-recheck:schedule-1:attempt-1$/);
    // The booking itself is not moved: a recheck is a question.
    assert.equal(
      recorder
        .writes()
        .some((call) => call.operation.startsWith("tradieSchedule.")),
      false,
    );
  });

  test("a replayed attempt says so and sends nothing", async () => {
    let sends = 0;
    const recorder = recordingDb({
      "outboxEvent.findUnique": {
        id: "event-1",
        key: "k",
        result: { to: "ace@example.com" },
        status: "SUCCEEDED",
      },
      "outboxEvent.upsert": {
        id: "event-1",
        key: "k",
        result: { to: "ace@example.com" },
        status: "SUCCEEDED",
      },
      "project.findUnique": PROJECT,
      "tradieSchedule.findUnique": OVER_INVOICED,
    });
    const result = await requestTradieInvoiceRecheck(
      adminPrincipal(),
      {
        attemptKey: "attempt-1",
        projectId: PROJECT.id,
        scheduleId: "schedule-1",
      },
      recorder.db,
      async () => {
        sends += 1;
      },
    );
    assert.equal(result.alreadySent, true);
    assert.equal(sends, 0);
  });

  test("refuses without an attempt key, before anything is read", async () => {
    const recorder = recordingDb();
    await assert.rejects(
      requestTradieInvoiceRecheck(
        adminPrincipal(),
        { attemptKey: " ", projectId: PROJECT.id, scheduleId: "schedule-1" },
        recorder.db,
        async () => {},
      ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.calls, []);
  });
});
