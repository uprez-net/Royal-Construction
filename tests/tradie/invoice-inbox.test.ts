import assert from "node:assert/strict";

import { InvoiceStatus, Prisma, TradieScheduleStatus } from "@prisma/client";
import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
} from "@/lib/domain/errors";
import { anonymousPrincipal, systemPrincipal } from "@/lib/domain/principal";
import {
  confirmEmailedTradieInvoice,
  dismissEmailedTradieInvoice,
  invoiceAttachmentCandidates,
  placeEmailedTradieInvoice,
  queueEmailedTradieInvoice,
  type QueueEmailedInvoiceInput,
} from "@/lib/domain/tradies/invoice-inbox";
import { bookingBilling } from "@/lib/domain/tradies/billing-rules";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// Tradie invoices that arrive by email are read by OCR and a model, so they
// are queued, never counted, until the office confirms them. What is pinned
// here: which attachments are even looked at, that a duplicate or a
// redelivery is not queued twice, and that only a pending entry settles.

const WORKFLOW = systemPrincipal("workflow:tradie-invoice-email");
const PROJECT = {
  id: "project-1",
  location: "1 Site St",
  name: "Smith build",
  siteManagerId: null,
};

const QUEUE: QueueEmailedInvoiceInput = {
  attachmentId: "att-1",
  document: {
    name: "INV-7.pdf",
    url: "https://store.public.blob.vercel-storage.com/projects/project-1/tradie-invoices/email/x.pdf",
  },
  dueDate: "2026-11-30",
  fromAddress: "ace@example.com",
  graphMessageId: "msg-1",
  invoiceNumber: " INV-7 ",
  issuedDate: "2026-11-01",
  mailbox: "business",
  projectId: PROJECT.id,
  receivedAt: new Date("2026-11-01T02:00:00.000Z"),
  scheduleId: "schedule-1",
  subTotal: 1000,
  subject: "Invoice INV-7",
  total: 1100,
  totalTax: 100,
  tradieId: "tradie-1",
};

describe("which attachments are read", () => {
  test("files only: no inline logo, forwarded email, odd type or oversized file", () => {
    const base = {
      contentType: "application/pdf",
      isInline: false,
      odataType: "#microsoft.graph.fileAttachment",
      size: 50_000,
    };
    const picked = invoiceAttachmentCandidates([
      { ...base, id: "pdf", name: "INV-7.pdf" },
      { ...base, contentType: "image/jpeg", id: "photo", name: "inv.jpg" },
      {
        ...base,
        contentType: "application/octet-stream",
        id: "octet-pdf",
        name: "INV-8.PDF",
      },
      {
        ...base,
        contentType: "image/png",
        id: "logo",
        isInline: true,
        name: "logo.png",
      },
      {
        ...base,
        id: "forwarded",
        name: "Fwd",
        odataType: "#microsoft.graph.itemAttachment",
      },
      {
        ...base,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        id: "word",
        name: "inv.docx",
      },
      { ...base, id: "huge", name: "big.pdf", size: 50 * 1024 * 1024 },
    ]);
    assert.deepEqual(
      picked.map((file) => [file.id, file.contentType]),
      [
        ["pdf", "application/pdf"],
        ["photo", "image/jpeg"],
        ["octet-pdf", "application/pdf"],
      ],
    );
  });
});

describe("placing an emailed invoice", () => {
  test("a booking reference in the subject places it on that booking", async () => {
    const recorder = recordingDb({
      "project.findUnique": { name: PROJECT.name },
      "tradie.findUnique": { id: "tradie-1", name: "Ace Carpentry" },
      "tradieSchedule.findUnique": {
        id: "schedule-1",
        projectId: PROJECT.id,
        tradie: { id: "tradie-1", name: "Ace Carpentry" },
      },
    });
    const placement = await placeEmailedTradieInvoice(
      WORKFLOW,
      {
        body: "Please find attached.",
        subject: "Invoice for frame [RCTBK-0123456789AB]",
        tradieId: "tradie-1",
      },
      recorder.db,
    );
    assert.equal(placement.projectId, PROJECT.id);
    assert.equal(placement.scheduleId, "schedule-1");
    assert.deepEqual(recorder.writes(), []);
  });

  test("without a reference, two projects leave it unplaced", async () => {
    const recorder = recordingDb({
      "tradie.findUnique": { id: "tradie-1", name: "Ace Carpentry" },
      "tradieSchedule.findMany": [
        { id: "a", projectId: "p-1", status: TradieScheduleStatus.CONFIRMED },
        { id: "b", projectId: "p-2", status: TradieScheduleStatus.CONFIRMED },
      ],
    });
    const placement = await placeEmailedTradieInvoice(
      WORKFLOW,
      { body: "", subject: "Invoice", tradieId: "tradie-1" },
      recorder.db,
    );
    assert.equal(placement.projectId, null);
  });

  test("is the workflow's to do, not an anonymous caller's", async () => {
    await assert.rejects(
      placeEmailedTradieInvoice(
        anonymousPrincipal("graph"),
        { body: "", subject: "", tradieId: "tradie-1" },
        recordingDb().db,
      ),
      DomainAuthorizationError,
    );
  });
});

describe("queueing an emailed invoice", () => {
  test("queues it, trimmed and in cents, counting nowhere", async () => {
    const recorder = recordingDb({
      "tradieInvoice.findFirst": null,
      "tradieInvoiceInbox.create": { id: "inbox-1" },
      "tradieInvoiceInbox.findUnique": null,
    });
    const outcome = await queueEmailedTradieInvoice(
      WORKFLOW,
      QUEUE,
      recorder.db,
    );
    assert.deepEqual(outcome, { inboxId: "inbox-1", outcome: "queued" });
    // Nothing touches the invoices C is counted from.
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["tradieInvoiceInbox.create"],
    );
    const data = (
      recorder.writes()[0].args as { data: Record<string, unknown> }
    ).data;
    assert.equal(data.invoiceNumber, "INV-7");
    assert.equal(String(data.subTotal), "1000");
    assert.equal(data.mailbox, "BUSINESS");
    assert.deepEqual(data.issuedDate, new Date("2026-11-01T00:00:00.000Z"));
  });

  test("a redelivered notification does not queue it twice", async () => {
    const recorder = recordingDb({
      "tradieInvoiceInbox.findUnique": { id: "inbox-1" },
    });
    assert.deepEqual(
      await queueEmailedTradieInvoice(WORKFLOW, QUEUE, recorder.db),
      { inboxId: "inbox-1", outcome: "already-queued" },
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("an invoice already recorded is not queued for the office to refuse", async () => {
    const recorder = recordingDb({
      "tradieInvoice.findFirst": { id: "recorded" },
      "tradieInvoiceInbox.findUnique": null,
    });
    assert.deepEqual(
      await queueEmailedTradieInvoice(WORKFLOW, QUEUE, recorder.db),
      { outcome: "already-recorded" },
    );
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("settling an emailed invoice", () => {
  const pending = {
    "project.findUnique": PROJECT,
    "tradieInvoiceInbox.findUnique": {
      id: "inbox-1",
      projectId: PROJECT.id,
      status: "PENDING",
    },
  };

  test("confirming links the recorded invoice", async () => {
    const recorder = recordingDb(pending);
    await confirmEmailedTradieInvoice(
      adminPrincipal(),
      { inboxId: "inbox-1", invoiceId: "invoice-1", projectId: PROJECT.id },
      recorder.db,
    );
    const [update] = recorder.writes();
    const args = update.args as {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    };
    assert.equal(args.data.status, "CONFIRMED");
    assert.equal(args.data.invoiceId, "invoice-1");
    assert.equal(args.where.status, "PENDING");
  });

  test("one already settled is refused", async () => {
    const recorder = recordingDb({
      ...pending,
      "tradieInvoiceInbox.findUnique": {
        id: "inbox-1",
        projectId: PROJECT.id,
        status: "DISMISSED",
      },
    });
    await assert.rejects(
      dismissEmailedTradieInvoice(
        adminPrincipal(),
        { inboxId: "inbox-1", projectId: PROJECT.id },
        recorder.db,
      ),
      DomainTransitionError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("another project's entry is not found", async () => {
    const recorder = recordingDb({
      ...pending,
      "tradieInvoiceInbox.findUnique": {
        id: "inbox-1",
        projectId: "project-9",
        status: "PENDING",
      },
    });
    await assert.rejects(
      dismissEmailedTradieInvoice(
        adminPrincipal(),
        { inboxId: "inbox-1", projectId: PROJECT.id },
        recorder.db,
      ),
      DomainNotFoundError,
    );
  });

  test("only an admin settles one", async () => {
    await assert.rejects(
      dismissEmailedTradieInvoice(
        siteManagerPrincipal(),
        { inboxId: "inbox-1", projectId: PROJECT.id },
        recordingDb(pending).db,
      ),
      DomainAuthorizationError,
    );
  });
});

describe("a booking's billing state, as the Tradies tab shows it", () => {
  const booking = {
    durationDays: 1,
    quote: { gstTreatment: null },
    quotedPrice: "1000.00",
    requiresQuote: true,
    status: TradieScheduleStatus.CONFIRMED,
    tradie: { lastQuotedPrice: null, lastQuotedPriceUnit: "FIXED" as const },
  };

  test("follows the counted invoices against the quote", () => {
    assert.equal(bookingBilling({ ...booking, invoices: [] }), "NOT_INVOICED");
    assert.equal(
      bookingBilling({
        ...booking,
        invoices: [
          {
            status: InvoiceStatus.AUTHORISED,
            subTotal: new Prisma.Decimal(400),
          },
          { status: InvoiceStatus.VOIDED, subTotal: new Prisma.Decimal(900) },
        ],
      }),
      "PART_INVOICED",
    );
    assert.equal(
      bookingBilling({
        ...booking,
        invoices: [{ status: InvoiceStatus.PAID, subTotal: "1200.00" }],
      }),
      "OVER_INVOICED",
    );
  });

  test("a booking neither committed nor billed has no billing state", () => {
    assert.equal(
      bookingBilling({
        ...booking,
        invoices: [],
        status: TradieScheduleStatus.PENDING_RESPONSE,
      }),
      null,
    );
  });
});
