import assert from "node:assert/strict";
import {
  InvoiceStatus,
  TradieInvoiceSource,
  TradieScheduleStatus,
} from "@prisma/client";
import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import { getProjectFinancials } from "@/lib/domain/projects/financials";
import {
  allocateTradieInvoice,
  recordTradieInvoice,
  syncTradieBillFromExternal,
  voidTradieInvoice,
  type ExternalTradieBill,
} from "@/lib/domain/tradies/invoices";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// The tradie invoice commands behind the Financials tab (issue #405). C is
// money the business owes, so the refusals matter as much as the writes: a
// second copy of one invoice doubles what a job looks like it cost.

const PROJECT = {
  id: "project-1",
  location: "1 Site St",
  name: "Smith build",
  siteManagerId: null,
};

const SCHEDULE = {
  id: "schedule-1",
  milestoneId: "milestone-1",
  projectId: PROJECT.id,
  tradie: { id: "tradie-1", name: "Ace Carpentry" },
};

const PRICED_SCHEDULE = {
  durationDays: 3,
  invoices: [{ status: InvoiceStatus.AUTHORISED, subTotal: "1000.00" }],
  quote: { gstTreatment: "EXCLUSIVE" },
  quotedPrice: "4000.00",
  requiresQuote: true,
  status: TradieScheduleStatus.CONFIRMED,
  tradie: { lastQuotedPrice: null, lastQuotedPriceUnit: "FIXED" },
};

const INPUT = {
  invoiceNumber: " INV-001 ",
  issuedDate: new Date("2026-11-10T00:00:00.000Z"),
  projectId: PROJECT.id,
  scheduleId: SCHEDULE.id,
  subTotal: 1000,
  totalTax: 100,
};

describe("recordTradieInvoice", () => {
  test.each([
    ["site manager", siteManagerPrincipal()],
    ["customer", customerPrincipal()],
  ])("refuses a %s, and writes nothing", async (_label, principal) => {
    const recorder = recordingDb();
    await assert.rejects(
      recordTradieInvoice(principal, INPUT, recorder.db),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("records against the booking, trimmed, and logs it on the tradie", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieInvoice.create": { id: "invoice-1" },
      "tradieInvoice.findFirst": null,
      "tradieSchedule.findUnique": SCHEDULE,
      "tradieSchedule.findUniqueOrThrow": PRICED_SCHEDULE,
    });
    const result = await recordTradieInvoice(
      adminPrincipal(),
      INPUT,
      recorder.db,
    );
    assert.equal(result.billing, "PART_INVOICED");
    const [create, log] = recorder.writes();
    assert.equal(create.operation, "tradieInvoice.create");
    const data = (create.args as { data: Record<string, unknown> }).data;
    assert.equal(data.invoiceNumber, "INV-001");
    assert.equal(data.source, TradieInvoiceSource.MANUAL);
    assert.equal(String(data.subTotal), "1000");
    assert.equal(String(data.totalTax), "100");
    assert.equal(String(data.total), "1100");
    assert.equal(data.tradieId, "tradie-1");
    assert.equal(log.operation, "tradieActivityLog.create");
  });

  test("refuses an invoice number already recorded for the tradie", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieInvoice.findFirst": { id: "existing" },
      "tradieSchedule.findUnique": SCHEDULE,
    });
    await assert.rejects(
      recordTradieInvoice(adminPrincipal(), INPUT, recorder.db),
      (error) =>
        error instanceof DomainValidationError
        && error.field === "invoiceNumber",
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("turns the database's duplicate guard into the same refusal", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieInvoice.create": () => {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      },
      "tradieInvoice.findFirst": null,
      "tradieSchedule.findUnique": SCHEDULE,
    });
    await assert.rejects(
      recordTradieInvoice(adminPrincipal(), INPUT, recorder.db),
      DomainValidationError,
    );
  });

  test.each([
    ["no number", { invoiceNumber: "  " }, "invoiceNumber"],
    ["a zero amount", { subTotal: 0 }, "subTotal"],
    ["GST over 10%", { subTotal: 100, totalTax: 50 }, "totalTax"],
    [
      "a due date before the invoice",
      { dueDate: new Date("2026-11-01T00:00:00.000Z") },
      "dueDate",
    ],
  ])("refuses %s", async (_label, overrides, field) => {
    const recorder = recordingDb({ "project.findUnique": PROJECT });
    await assert.rejects(
      recordTradieInvoice(
        adminPrincipal(),
        { ...INPUT, ...overrides },
        recorder.db,
      ),
      (error) =>
        error instanceof DomainValidationError && error.field === field,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("refuses a booking on another project", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieSchedule.findUnique": { ...SCHEDULE, projectId: "elsewhere" },
    });
    await assert.rejects(
      recordTradieInvoice(adminPrincipal(), INPUT, recorder.db),
      DomainNotFoundError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("allocate and void", () => {
  const UNALLOCATED = {
    id: "invoice-1",
    invoiceNumber: "X-1",
    projectId: PROJECT.id,
    scheduleId: null,
    status: InvoiceStatus.AUTHORISED,
    subTotal: "500.00",
    tradieId: "tradie-1",
  };

  test("will not put an invoice on another tradie's booking", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieInvoice.findUnique": UNALLOCATED,
      "tradieSchedule.findUnique": {
        ...SCHEDULE,
        tradie: { id: "tradie-2", name: "Other" },
      },
    });
    await assert.rejects(
      allocateTradieInvoice(
        adminPrincipal(),
        {
          invoiceId: "invoice-1",
          projectId: PROJECT.id,
          scheduleId: SCHEDULE.id,
        },
        recorder.db,
      ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("allocates to the tradie's own booking", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieInvoice.findUnique": UNALLOCATED,
      "tradieSchedule.findUnique": SCHEDULE,
      "tradieSchedule.findUniqueOrThrow": PRICED_SCHEDULE,
    });
    await allocateTradieInvoice(
      adminPrincipal(),
      {
        invoiceId: "invoice-1",
        projectId: PROJECT.id,
        scheduleId: SCHEDULE.id,
      },
      recorder.db,
    );
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["tradieInvoice.update", "tradieActivityLog.create"],
    );
  });

  test("a bill from Xero is voided in Xero, not here", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieInvoice.findUnique": {
        ...UNALLOCATED,
        schedule: null,
        source: TradieInvoiceSource.XERO,
      },
    });
    await assert.rejects(
      voidTradieInvoice(
        adminPrincipal(),
        { invoiceId: "invoice-1", projectId: PROJECT.id, reason: "dupe" },
        recorder.db,
      ),
      DomainTransitionError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("voiding twice logs once", async () => {
    const recorder = recordingDb({
      "project.findUnique": PROJECT,
      "tradieInvoice.findUnique": {
        ...UNALLOCATED,
        schedule: { id: SCHEDULE.id, milestoneId: SCHEDULE.milestoneId },
        source: TradieInvoiceSource.MANUAL,
      },
      "tradieInvoice.updateMany": { count: 0 },
    });
    await voidTradieInvoice(
      adminPrincipal(),
      {
        invoiceId: "invoice-1",
        projectId: PROJECT.id,
        reason: "Entered twice",
      },
      recorder.db,
    );
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["tradieInvoice.updateMany"],
    );
  });
});

describe("syncTradieBillFromExternal", () => {
  const XERO = systemPrincipal("xero:bill-webhook");
  const BILL: ExternalTradieBill = {
    amountPaid: 0,
    contact: { emails: [], name: "Ace Carpentry", taxNumber: "51 824 753 556" },
    currencyCode: "AUD",
    dueDate: null,
    invoiceNumber: "INV-001",
    issuedDate: new Date("2026-11-10T00:00:00.000Z"),
    reference: "Frame [RCTBK-0123456789AB]",
    status: InvoiceStatus.AUTHORISED,
    subTotal: 1000,
    total: 1100,
    totalTax: 100,
    xeroInvoiceId: "xero-1",
    xeroUpdatedAt: new Date("2026-11-10T01:00:00.000Z"),
  };
  const ACE = {
    abn: "51824753556",
    email: "ace@example.com",
    id: "tradie-1",
    name: "Ace Carpentry",
  };

  test("is only the webhook's to call", async () => {
    const recorder = recordingDb();
    await assert.rejects(
      syncTradieBillFromExternal(adminPrincipal(), BILL, recorder.db),
      DomainAuthorizationError,
    );
  });

  test("a bill from nobody in the directory is left alone", async () => {
    const recorder = recordingDb({
      "tradie.findFirst": null,
      "tradie.findMany": [],
      "tradieInvoice.findUnique": null,
    });
    const result = await syncTradieBillFromExternal(
      XERO,
      {
        ...BILL,
        contact: {
          emails: ["accounts@power.co"],
          name: "Power Co",
          taxNumber: null,
        },
        reference: null,
      },
      recorder.db,
    );
    assert.equal(result.kind, "not-a-tradie");
    assert.deepEqual(recorder.writes(), []);
  });

  test("the RCTBK reference places the bill on its booking", async () => {
    const recorder = recordingDb({
      "project.findUniqueOrThrow": { name: PROJECT.name },
      "tradie.findMany": [ACE],
      "tradieInvoice.create": { id: "invoice-1" },
      "tradieInvoice.findFirst": null,
      "tradieInvoice.findUnique": null,
      "tradieSchedule.findUnique": {
        id: SCHEDULE.id,
        projectId: PROJECT.id,
        tradie: SCHEDULE.tradie,
      },
      "tradieSchedule.findUniqueOrThrow": {
        milestoneId: SCHEDULE.milestoneId,
        projectId: PROJECT.id,
        tradieId: "tradie-1",
      },
    });
    const result = await syncTradieBillFromExternal(XERO, BILL, recorder.db);
    assert.equal(result.kind, "created");
    assert.equal("scheduleId" in result && result.scheduleId, SCHEDULE.id);
    const create = recorder.writes()[0];
    const data = (create.args as { data: Record<string, unknown> }).data;
    assert.equal(data.source, TradieInvoiceSource.XERO);
    assert.equal(data.xeroInvoiceId, "xero-1");
  });

  test("a reference to another tradie's booking is not trusted over the contact", async () => {
    const recorder = recordingDb({
      "project.findUniqueOrThrow": { name: PROJECT.name },
      "tradie.findMany": [ACE],
      "tradieInvoice.create": { id: "invoice-1" },
      "tradieInvoice.findFirst": null,
      "tradieInvoice.findUnique": null,
      // RCTBK names a booking of someone else...
      "tradieSchedule.findUnique": {
        id: "someone-elses",
        projectId: "project-9",
        tradie: { id: "tradie-9", name: "Other" },
      },
      // ...so Ace's own committed bookings decide: two on one project.
      "tradieSchedule.findMany": [
        {
          id: "a",
          projectId: PROJECT.id,
          status: TradieScheduleStatus.CONFIRMED,
        },
        {
          id: "b",
          projectId: PROJECT.id,
          status: TradieScheduleStatus.COMPLETED,
        },
      ],
    });
    const result = await syncTradieBillFromExternal(XERO, BILL, recorder.db);
    assert.equal(result.kind, "created");
    assert.ok("projectId" in result);
    assert.equal(result.projectId, PROJECT.id);
    // Two bookings it could be: kept unallocated for the office, not guessed.
    assert.equal(result.scheduleId, null);
  });

  test("adopts the invoice the office already typed in instead of counting it twice", async () => {
    const recorder = recordingDb({
      "project.findUniqueOrThrow": { name: PROJECT.name },
      "tradie.findMany": [ACE],
      "tradieInvoice.findFirst": {
        id: "typed-in",
        projectId: PROJECT.id,
        scheduleId: SCHEDULE.id,
      },
      "tradieInvoice.findUnique": null,
      "tradieInvoice.update": {
        project: { name: PROJECT.name },
        projectId: PROJECT.id,
        scheduleId: SCHEDULE.id,
      },
      "tradieSchedule.findUnique": {
        id: SCHEDULE.id,
        projectId: PROJECT.id,
        tradie: SCHEDULE.tradie,
      },
    });
    const result = await syncTradieBillFromExternal(XERO, BILL, recorder.db);
    assert.equal(result.kind, "adopted");
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["tradieInvoice.update"],
    );
  });

  test("a typed-in invoice gives the project when the tradie works on several", async () => {
    const recorder = recordingDb({
      "tradie.findMany": [ACE],
      "tradieInvoice.findFirst": {
        id: "typed-in",
        projectId: PROJECT.id,
        scheduleId: SCHEDULE.id,
      },
      "tradieInvoice.findUnique": null,
      "tradieInvoice.update": {
        project: { name: PROJECT.name },
        projectId: PROJECT.id,
        scheduleId: SCHEDULE.id,
      },
      // No usable reference, and committed bookings on two projects.
      "tradieSchedule.findMany": [
        {
          id: "a",
          projectId: PROJECT.id,
          status: TradieScheduleStatus.CONFIRMED,
        },
        {
          id: "b",
          projectId: "project-2",
          status: TradieScheduleStatus.CONFIRMED,
        },
      ],
    });
    const result = await syncTradieBillFromExternal(
      XERO,
      { ...BILL, reference: null },
      recorder.db,
    );
    assert.equal(result.kind, "adopted");
    assert.ok("projectId" in result);
    assert.equal(result.projectId, PROJECT.id);
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["tradieInvoice.update"],
    );
  });

  test("an older delivery does not overwrite a newer one", async () => {
    const recorder = recordingDb({
      "tradieInvoice.findUnique": {
        id: "invoice-1",
        project: { name: PROJECT.name },
        projectId: PROJECT.id,
        scheduleId: SCHEDULE.id,
        status: InvoiceStatus.PAID,
        tradie: SCHEDULE.tradie,
        xeroUpdatedAt: new Date("2026-11-12T00:00:00.000Z"),
      },
    });
    const result = await syncTradieBillFromExternal(XERO, BILL, recorder.db);
    assert.equal(result.kind, "stale");
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("getProjectFinancials", () => {
  test("is admin only", async () => {
    const recorder = recordingDb();
    await assert.rejects(
      getProjectFinancials(
        siteManagerPrincipal(),
        { projectId: PROJECT.id },
        recorder.db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.calls, []);
  });
});
