import assert from "node:assert/strict";

import { Prisma } from "@prisma/client";
import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainSideEffectError,
  DomainValidationError,
} from "@/lib/domain/errors";
import type {
  VariationInvoiceFields,
  VariationIssuePorts,
} from "@/lib/domain/ports/variation";
import {
  issueVariation,
  variationInvoiceReference,
} from "@/lib/domain/projects/variation-issue";
import {
  draftVariation,
  raiseVariation,
} from "@/lib/domain/projects/variation-raise";
import {
  activityClientPriceCents,
  formatVariationNumber,
  summarizeVariations,
  variationCharge,
} from "@/lib/domain/projects/variation-rules";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Variations reprice an activity for the client, or for the builder to
// absorb. What is pinned here is the money in front of the client: what it
// is charged, that a promotional variation is never invoiced, that a refused
// variation writes nothing, and that a failed step is written down rather
// than reported as sent.

const decimal = (value: number) => new Prisma.Decimal(value);

/** One project row that answers both the access check and the context read. */
const projectRow = {
  customer: { email: "jane@example.com", name: "Jane Smith" },
  customers: [
    { customer: { email: "jane@example.com", name: "Jane Smith" } },
    { customer: { email: "john@example.com", name: "John Smith" } },
  ],
  id: "p_1",
  location: "12 Smith St, Parramatta NSW",
  milestones: [
    {
      budget: decimal(10_000),
      id: "m_roof",
      name: "Roof framing",
      order: 1,
      parentId: null,
      projectStage: "Frame",
      status: "PENDING",
    },
  ],
  name: "Smith Residence",
  siteManagerId: null,
  variations: [
    // An earlier chargeable variation moved the price to $11,000; a
    // promotional one did not move what the client pays.
    {
      cost: decimal(1_000),
      id: "v_earlier",
      kind: "CHARGEABLE",
      milestoneId: "m_roof",
      number: 1,
      status: "APPROVED",
    },
    {
      cost: decimal(500),
      id: "v_promo",
      kind: "PROMOTIONAL",
      milestoneId: "m_roof",
      number: 2,
      status: "APPROVED",
    },
  ],
};

const draft = {
  kind: "CHARGEABLE" as const,
  milestoneId: "m_roof",
  newPrice: 12_500,
  projectId: "p_1",
  reason: "Hipped roof at the owners' request.",
};

describe("variation rules", () => {
  test("the client's price moves with chargeable variations only", () => {
    assert.equal(
      activityClientPriceCents({
        budgetCents: 1_000_000,
        variations: [
          { costCents: 100_000, kind: "CHARGEABLE", status: "APPROVED" },
          { costCents: 50_000, kind: "PROMOTIONAL", status: "APPROVED" },
          { costCents: 70_000, kind: "CHARGEABLE", status: "REJECTED" },
        ],
      }),
      1_100_000,
    );
  });

  test("a chargeable variation bills the difference plus GST", () => {
    assert.deepEqual(
      variationCharge({
        kind: "CHARGEABLE",
        newPriceCents: 1_250_000,
        previousPriceCents: 1_000_000,
      }),
      {
        absorbedCents: 0,
        chargeExGstCents: 250_000,
        chargeIncGstCents: 275_000,
        differenceCents: 250_000,
        gstCents: 25_000,
      },
    );
  });

  test("a promotional variation charges the client nothing", () => {
    const charge = variationCharge({
      kind: "PROMOTIONAL",
      newPriceCents: 1_250_000,
      previousPriceCents: 1_000_000,
    });
    assert.equal(charge.chargeIncGstCents, 0);
    assert.equal(charge.gstCents, 0);
    assert.equal(charge.absorbedCents, 250_000);
  });

  test("numbers read V-001", () => {
    assert.equal(formatVariationNumber(1), "V-001");
    assert.equal(formatVariationNumber(42), "V-042");
  });

  test("the KPI cards split by who pays and leave rejected ones out", () => {
    const summary = summarizeVariations([
      {
        costCents: 250_000,
        invoiceAmountPaidCents: 0,
        invoiceStatus: "AUTHORISED",
        invoiceTotalCents: 275_000,
        kind: "CHARGEABLE",
        needsAttention: false,
        status: "APPROVED",
      },
      {
        costCents: 80_000,
        invoiceAmountPaidCents: null,
        invoiceStatus: null,
        invoiceTotalCents: null,
        kind: "PROMOTIONAL",
        needsAttention: true,
        status: "APPROVED",
      },
      {
        costCents: 99_999,
        invoiceAmountPaidCents: null,
        invoiceStatus: null,
        invoiceTotalCents: null,
        kind: "CHARGEABLE",
        needsAttention: false,
        status: "REJECTED",
      },
    ]);
    assert.deepEqual(summary, {
      awaitingPaymentCents: 275_000,
      chargeable: { cents: 250_000, count: 1 },
      count: 2,
      needsAttention: 1,
      promotional: { cents: 80_000, count: 1 },
    });
  });
});

describe("raising a variation", () => {
  test("the draft is priced from the client's current price, not the budget", async () => {
    const recorder = recordingDb({ "project.findUnique": projectRow });
    const { document, recipients } = await draftVariation(
      adminPrincipal(),
      draft,
      recorder.db,
    );
    // $10,000 budget + $1,000 chargeable; the $500 promotional is not in it.
    assert.equal(document.previousPriceCents, 1_100_000);
    assert.equal(document.differenceCents, 150_000);
    assert.equal(document.chargeIncGstCents, 165_000);
    assert.equal(document.number, "V-003");
    assert.deepEqual(
      recipients.map((recipient) => recipient.email),
      ["jane@example.com", "john@example.com"],
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a price at or below the current one is refused and nothing is written", async () => {
    const recorder = recordingDb({
      "project.findUnique": projectRow,
      "variation.findUnique": null,
    });
    await assert.rejects(
      () =>
        raiseVariation(
          adminPrincipal(),
          { ...draft, newPrice: 11_000, requestKey: "k_1" },
          recorder.db,
        ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a variation without a reason is refused", async () => {
    const recorder = recordingDb({
      "project.findUnique": projectRow,
      "variation.findUnique": null,
    });
    await assert.rejects(
      () =>
        raiseVariation(
          adminPrincipal(),
          { ...draft, reason: "  ", requestKey: "k_1" },
          recorder.db,
        ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("only an admin raises one", async () => {
    const recorder = recordingDb({ "project.findUnique": projectRow });
    await assert.rejects(
      () =>
        raiseVariation(
          siteManagerPrincipal(),
          { ...draft, requestKey: "k_1" },
          recorder.db,
        ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("it is written approved, numbered, with both prices", async () => {
    const recorder = recordingDb({
      "project.findUnique": projectRow,
      "variation.create": {
        cost: decimal(1_500),
        description: draft.reason,
        id: "v_new",
        kind: "CHARGEABLE",
        number: 3,
        projectId: "p_1",
      },
      "variation.findUnique": null,
    });
    const raised = await raiseVariation(
      adminPrincipal(),
      { ...draft, requestKey: "k_1" },
      recorder.db,
    );
    assert.equal(raised.replayed, false);
    const [create] = recorder.writes();
    const data = (create.args as { data: Record<string, unknown> }).data;
    assert.equal(data.status, "APPROVED");
    assert.equal(data.number, 3);
    assert.equal(String(data.previousPrice), "11000");
    assert.equal(String(data.newPrice), "12500");
    assert.equal(String(data.cost), "1500");
    assert.equal(data.requestKey, "k_1");
  });

  test("the same request key returns the variation already raised", async () => {
    // A double-click on Send, or a retry after a timeout, must not raise a
    // second variation — and with it a second invoice to the client.
    const recorder = recordingDb({
      "project.findUnique": projectRow,
      "variation.findUnique": {
        cost: decimal(1_500),
        description: draft.reason,
        id: "v_new",
        kind: "CHARGEABLE",
        number: 3,
        projectId: "p_1",
      },
    });
    const raised = await raiseVariation(
      adminPrincipal(),
      { ...draft, requestKey: "k_1" },
      recorder.db,
    );
    assert.equal(raised.replayed, true);
    assert.equal(raised.id, "v_new");
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("issuing a variation", () => {
  const row = (kind: "CHARGEABLE" | "PROMOTIONAL") => ({
    approvedDate: new Date("2026-11-01T00:00:00.000Z"),
    description: draft.reason,
    documentUrl: null,
    id: "v_new",
    issueError: null,
    kind,
    milestoneId: "m_roof",
    newPrice: decimal(12_500),
    number: 3,
    previousPrice: decimal(11_000),
    projectId: "p_1",
    requestedDate: new Date("2026-11-01T00:00:00.000Z"),
    sentAt: null,
    sentTo: [] as string[],
    status: "APPROVED",
    xeroInvoiceId: null,
    xeroInvoiceNumber: null,
  });

  /** The outbox reads and writes a fresh intent goes through. */
  const outbox = {
    "outboxEvent.findUnique": (args: unknown) => ({
      attempts: 0,
      id: "ob_1",
      key: (args as { where: { key: string } }).where.key,
      kind: "VARIATION_EMAIL_SEND",
      payload: {},
      status: "PENDING",
    }),
    "outboxEvent.upsert": (args: unknown) => ({
      id: "ob_1",
      key: (args as { where: { key: string } }).where.key,
      result: null,
      status: "PENDING",
    }),
  };

  const invoice: VariationInvoiceFields = {
    amountPaidCents: 0,
    invoiceNumber: "INV-0042",
    status: "AUTHORISED",
    taxCents: 15_000,
    totalCents: 165_000,
    updatedAt: null,
    xeroInvoiceId: "xero_1",
  };

  function ports(
    steps: string[],
    fail?: "xero" | "email",
    failFor?: string,
  ): VariationIssuePorts {
    return {
      raiseInvoice: async (input) => {
        steps.push(`xero:${input.amountExGstCents}`);
        steps.push(`reference:${input.reference}`);
        if (fail === "xero") throw new Error("Xero is down");
        return invoice;
      },
      sendEmail: async (input) => {
        steps.push(`email:${input.to}:${input.document.invoiceNumber ?? "-"}`);
        if (fail === "email" && (!failFor || failFor === input.to)) {
          throw new Error("Graph refused");
        }
      },
      storeDocument: async (input) => {
        steps.push(`document:${input.document.chargeIncGstCents}`);
        return { url: "https://store.public.blob.vercel-storage.com/v.pdf" };
      },
    };
  }

  test("chargeable: Xero first, then the document carrying its number, then each owner", async () => {
    const steps: string[] = [];
    const recorder = recordingDb({
      ...outbox,
      "project.findUnique": projectRow,
      "variation.findFirst": row("CHARGEABLE"),
    });
    const issued = await issueVariation(
      adminPrincipal(),
      { emailAttemptKey: "k_1", projectId: "p_1", variationId: "v_new" },
      recorder.db,
      ports(steps),
    );
    assert.deepEqual(steps, [
      "xero:150000",
      `reference:${variationInvoiceReference("V-003", "v_new")}`,
      "document:165000",
      "email:jane@example.com:INV-0042",
      "email:john@example.com:INV-0042",
    ]);
    assert.equal(issued.invoiceNumber, "INV-0042");
    assert.deepEqual(issued.emailedTo, [
      "jane@example.com",
      "john@example.com",
    ]);
  });

  test("promotional: never invoiced, and the client's total is $0", async () => {
    const steps: string[] = [];
    const recorder = recordingDb({
      ...outbox,
      "project.findUnique": projectRow,
      "variation.findFirst": row("PROMOTIONAL"),
    });
    await issueVariation(
      adminPrincipal(),
      { emailAttemptKey: "k_1", projectId: "p_1", variationId: "v_new" },
      recorder.db,
      ports(steps),
    );
    assert.deepEqual(steps, [
      "document:0",
      "email:jane@example.com:-",
      "email:john@example.com:-",
    ]);
  });

  test("a Xero failure is written on the variation and nothing is emailed", async () => {
    const steps: string[] = [];
    const recorder = recordingDb({
      ...outbox,
      "project.findUnique": projectRow,
      "variation.findFirst": row("CHARGEABLE"),
    });
    await assert.rejects(
      () =>
        issueVariation(
          adminPrincipal(),
          { emailAttemptKey: "k_1", projectId: "p_1", variationId: "v_new" },
          recorder.db,
          ports(steps, "xero"),
        ),
      DomainSideEffectError,
    );
    assert.deepEqual(steps.slice(0, 1), ["xero:150000"]);
    assert.equal(steps.length, 2);
    const issueError = recorder
      .writes()
      .filter((call) => call.operation === "variation.update")
      .map(
        (call) =>
          (call.args as { data: { issueError?: string } }).data.issueError,
      )
      .find(Boolean);
    assert.match(issueError ?? "", /Xero invoice was not raised: Xero is down/);
  });

  test("the invoice reference is the variation's own, not the project's name", () => {
    const a = variationInvoiceReference(
      "V-003",
      "0f1e2d3c-4b5a-6978-8a9b-acbdcedfe0f1",
    );
    const b = variationInvoiceReference(
      "V-003",
      "9a8b7c6d-5e4f-4031-8a2b-1c0d9e8f7a6b",
    );
    assert.equal(a, "Variation V-003 RCV-0F1E2D3C4B5A");
    assert.notEqual(a, b);
  });

  test("a send that fails part-way records who has it, and does not mark it sent", async () => {
    const steps: string[] = [];
    const recorder = recordingDb({
      ...outbox,
      "project.findUnique": projectRow,
      "variation.findFirst": row("PROMOTIONAL"),
    });
    await assert.rejects(
      () =>
        issueVariation(
          adminPrincipal(),
          { emailAttemptKey: "k_1", projectId: "p_1", variationId: "v_new" },
          recorder.db,
          ports(steps, "email", "john@example.com"),
        ),
      DomainSideEffectError,
    );
    const updates = recorder
      .writes()
      .filter((call) => call.operation === "variation.update")
      .map((call) => (call.args as { data: Record<string, unknown> }).data);
    assert.ok(
      updates.some(
        (data) =>
          JSON.stringify(data.sentTo) === JSON.stringify(["jane@example.com"]),
      ),
    );
    assert.ok(updates.every((data) => !("sentAt" in data)));
  });

  test("a retry emails only the owners the failed send did not reach", async () => {
    const steps: string[] = [];
    const recorder = recordingDb({
      ...outbox,
      "project.findUnique": projectRow,
      "variation.findFirst": {
        ...row("PROMOTIONAL"),
        documentUrl: "https://store.public.blob.vercel-storage.com/v.pdf",
        issueError: "The email to the client was not sent.",
        sentTo: ["jane@example.com"],
      },
    });
    await issueVariation(
      adminPrincipal(),
      { emailAttemptKey: "k_2", projectId: "p_1", variationId: "v_new" },
      recorder.db,
      ports(steps),
    );
    assert.deepEqual(steps, ["email:john@example.com:-"]);
    const sent = recorder
      .writes()
      .filter((call) => call.operation === "variation.update")
      .map((call) => (call.args as { data: Record<string, unknown> }).data)
      .find((data) => "sentAt" in data);
    assert.deepEqual(sent?.sentTo, ["jane@example.com", "john@example.com"]);
  });

  test("a retry emails the owners chosen when it was raised, not every owner", async () => {
    // The wizard picked Jane only; the invoice step then failed, so nothing
    // was sent. A Retry passes no list and must not widen it to John.
    const steps: string[] = [];
    const recorder = recordingDb({
      ...outbox,
      "project.findUnique": projectRow,
      "variation.findFirst": {
        ...row("PROMOTIONAL"),
        recipients: ["jane@example.com"],
      },
    });
    await issueVariation(
      adminPrincipal(),
      { emailAttemptKey: "k_3", projectId: "p_1", variationId: "v_new" },
      recorder.db,
      ports(steps),
    );
    assert.deepEqual(
      steps.filter((step) => step.startsWith("email:")),
      ["email:jane@example.com:-"],
    );
  });

  test("raising one keeps the owners chosen to email", async () => {
    const recorder = recordingDb({
      "project.findUnique": projectRow,
      "variation.create": {
        cost: decimal(1_500),
        description: draft.reason,
        id: "v_new",
        kind: "CHARGEABLE",
        number: 3,
        projectId: "p_1",
      },
      "variation.findUnique": null,
    });
    await raiseVariation(
      adminPrincipal(),
      { ...draft, recipients: ["jane@example.com"], requestKey: "k_9" },
      recorder.db,
    );
    const data = (
      recorder.writes()[0].args as { data: Record<string, unknown> }
    ).data;
    assert.deepEqual(data.recipients, ["jane@example.com"]);
  });

  test("an address that is not an owner's is refused before anything is sent", async () => {
    const steps: string[] = [];
    const recorder = recordingDb({
      "project.findUnique": projectRow,
      "variation.findFirst": row("CHARGEABLE"),
    });
    await assert.rejects(
      () =>
        issueVariation(
          adminPrincipal(),
          {
            emailAttemptKey: "k_1",
            projectId: "p_1",
            recipients: ["someone@elsewhere.com"],
            variationId: "v_new",
          },
          recorder.db,
          ports(steps),
        ),
      DomainValidationError,
    );
    assert.deepEqual(steps, []);
    assert.deepEqual(recorder.writes(), []);
  });
});
