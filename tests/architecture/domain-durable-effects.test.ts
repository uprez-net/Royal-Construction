import assert from "node:assert/strict";

import { OutboxEventStatus, ProjectStage } from "@prisma/client";
import { test } from "vitest";

import { sendCampaignEmail } from "@/lib/domain/email/operations";
import { createStageInvoice } from "@/lib/domain/invoices/stage-creation";
import {
  listRoleReconciliations,
  recordRoleReconciliation,
  resolveRoleReconciliation,
} from "@/lib/domain/identity/team";
import { DomainNotFoundError } from "@/lib/domain/errors";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "./domain-harness";

// Phase 7: the effects the OutboxEventKind enum promised were durable and
// were not — a campaign send, a stage claim, the PDF archive, and the record
// of a Clerk/local role divergence.

/** An outbox script whose intent is fresh and claimable. */
function pendingOutbox(extra: Record<string, unknown> = {}) {
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
      kind: "EMAIL_CAMPAIGN_SEND",
      payload: {},
      status: OutboxEventStatus.PENDING,
    }),
    "outboxEvent.updateMany": { count: 1 },
    ...extra,
  };
}

/* ------------------------------------------------------ campaign email -- */

test("a campaign reaches each lead once per press of Send", async () => {
  const sent: string[] = [];
  const keys: string[] = [];
  const script = pendingOutbox({
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
  });

  const first = await sendCampaignEmail(
    adminPrincipal(),
    {
      body: "<p>Hi</p>",
      runId: "run_1",
      subject: "Spring update",
      to: "Lead@Example.com",
    },
    async (input) => {
      sent.push(input.to);
    },
    recordingDb(script).db,
  );
  assert.deepEqual(first, { alreadySent: false, sent: true });
  assert.deepEqual(sent, ["Lead@Example.com"]);

  // The same run reaching the same person again — a retried batch, or a second
  // click — replays instead of emailing them twice from Royal's mailbox.
  const replay = await sendCampaignEmail(
    adminPrincipal(),
    {
      body: "<p>Hi</p>",
      runId: "run_1",
      subject: "Spring update",
      to: "Lead@Example.com",
    },
    async (input) => {
      sent.push(input.to);
    },
    recordingDb({
      "outboxEvent.upsert": {
        id: "effect_1",
        key: "email-campaign:run_1:lead@example.com",
        result: { to: "Lead@Example.com" },
        status: OutboxEventStatus.SUCCEEDED,
      },
    }).db,
  );
  assert.deepEqual(replay, { alreadySent: true, sent: true });
  assert.equal(sent.length, 1, "a replay must not re-send");

  // The key folds case, so the same address typed differently is one send.
  assert.deepEqual(keys, ["email-campaign:run_1:lead@example.com"]);
});

/** Outbox rows: the send's own state, and the history row's, by key prefix. */
function campaignOutbox(state: {
  send: OutboxEventStatus;
  history: OutboxEventStatus;
}) {
  return pendingOutbox({
    "outboxEvent.upsert": (args: unknown) => {
      const key = (args as { where: { key: string } }).where.key;
      const status = key.startsWith("email-campaign-history:")
        ? state.history
        : state.send;
      return {
        id: key,
        key,
        result: status === OutboxEventStatus.SUCCEEDED ? { done: true } : null,
        status,
      };
    },
  });
}

const CAMPAIGN_FOR_LEAD = {
  body: "b",
  leadId: 42,
  runId: "run_1",
  subject: "Spring update",
  to: "lead@example.com",
};

test("a campaign send writes the lead's history once, as its own keyed effect (#297)", async () => {
  const sent: string[] = [];
  const { db, calls } = recordingDb(
    campaignOutbox({
      history: OutboxEventStatus.PENDING,
      send: OutboxEventStatus.PENDING,
    }),
  );
  await sendCampaignEmail(
    adminPrincipal(),
    CAMPAIGN_FOR_LEAD,
    async (input) => {
      sent.push(input.to);
    },
    db,
  );

  assert.equal(sent.length, 1);
  assert.equal(
    calls.filter((call) => call.operation === "leadHistory.create").length,
    1,
  );
  const keys = calls
    .filter((call) => call.operation === "outboxEvent.upsert")
    .map((call) => (call.args as { where: { key: string } }).where.key);
  assert.deepEqual(keys, [
    "email-campaign:run_1:lead@example.com",
    "email-campaign-history:run_1:42",
  ]);
});

test("a retry repairs a history row that was never written, without re-sending", async () => {
  // The first attempt's email went out (the send effect SUCCEEDED) but the
  // process stopped before the row was written: the history effect is still
  // PENDING. The retry must write it and must not email the lead again.
  const sent: string[] = [];
  const { db, calls } = recordingDb(
    campaignOutbox({
      history: OutboxEventStatus.PENDING,
      send: OutboxEventStatus.SUCCEEDED,
    }),
  );
  const result = await sendCampaignEmail(
    adminPrincipal(),
    CAMPAIGN_FOR_LEAD,
    async (input) => {
      sent.push(input.to);
    },
    db,
  );

  assert.deepEqual(result, { alreadySent: true, sent: true });
  assert.equal(sent.length, 0);
  assert.equal(
    calls.filter((call) => call.operation === "leadHistory.create").length,
    1,
  );
});

test("a retry of a send whose history was already written adds no second row", async () => {
  const { db, calls } = recordingDb(
    campaignOutbox({
      history: OutboxEventStatus.SUCCEEDED,
      send: OutboxEventStatus.SUCCEEDED,
    }),
  );
  await sendCampaignEmail(
    adminPrincipal(),
    CAMPAIGN_FOR_LEAD,
    async () => {},
    db,
  );

  assert.equal(
    calls.filter((call) => call.operation === "leadHistory.create").length,
    0,
  );
});

test("a new campaign to the same lead is a new send", async () => {
  const keys: string[] = [];
  const script = pendingOutbox({
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
  });
  for (const runId of ["run_1", "run_2"]) {
    await sendCampaignEmail(
      adminPrincipal(),
      { body: "b", runId, subject: "s", to: "lead@example.com" },
      async () => {},
      recordingDb(script).db,
    );
  }
  assert.notEqual(keys[0], keys[1]);
});

test("a send with no run id is not deduplicated and needs no database", async () => {
  let sends = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await sendCampaignEmail(
      adminPrincipal(),
      { body: "b", subject: "s", to: "lead@example.com" },
      async () => {
        sends += 1;
      },
    );
    assert.deepEqual(result, { alreadySent: false, sent: true });
  }
  // A one-off send the operator composed is meant to go every time they ask.
  assert.equal(sends, 2);
});

test("campaign email refuses a caller who is not staff", async () => {
  let sends = 0;
  await assert.rejects(
    () =>
      sendCampaignEmail(
        customerPrincipal(),
        { body: "b", runId: "run_1", subject: "s", to: "lead@example.com" },
        async () => {
          sends += 1;
        },
        recordingDb(pendingOutbox()).db,
      ),
    (error) => error instanceof Error,
  );
  assert.equal(sends, 0);
});

/* -------------------------------------------------------- stage claims -- */

const STAGE_PROJECT = {
  customer: {
    address: "1 Example St",
    email: "owner@example.com",
    id: "c_1",
    name: "Owner",
    phone: "0400000000",
  },
  id: "p_1",
  name: "12 Example St",
  requirements: {
    commercialsAndClaims: {
      gstIncluded: true,
      paymentStages: [{ percentage: 100, stage: ProjectStage.Slab }],
      totalContractSum: 100_000,
    },
  },
  totalBudget: 100_000,
};

function stageInvoiceFields() {
  return {
    amountCredited: 0,
    amountDue: 0,
    amountPaid: 0,
    currencyCode: "AUD",
    dueDate: new Date("2026-10-15T00:00:00.000Z"),
    fullyPaidOnDate: null,
    invoiceNumber: "INV-1",
    issuedDate: new Date("2026-10-01T00:00:00.000Z"),
    reference: "ref",
    status: "AUTHORISED",
    subTotal: 0,
    total: 0,
    totalTax: 0,
    xeroUpdatedAt: null,
  } as never;
}

test("a stage claim records its intent before Xero is called", async () => {
  const order: string[] = [];
  const recorder = recordingDb({
    "project.findUnique": STAGE_PROJECT,
    "outboxEvent.upsert": (args: unknown) => {
      order.push(`intent:${(args as { where: { key: string } }).where.key}`);
      return {
        id: "effect_1",
        key: (args as { where: { key: string } }).where.key,
        result: null,
        status: OutboxEventStatus.PENDING,
      };
    },
    "outboxEvent.findUnique": {
      attempts: 0,
      id: "effect_1",
      key: "invoice-stage:p_1:Slab",
      kind: "INVOICE_STAGE_ISSUE",
      payload: {},
      status: OutboxEventStatus.PENDING,
    },
    "outboxEvent.updateMany": { count: 1 },
    "invoice.create": { id: "inv_1" },
    "invoice.findUnique": { id: "inv_1" },
  });

  const invoice = await createStageInvoice(
    {
      issuedDate: new Date("2026-10-01T00:00:00.000Z"),
      projectId: "p_1",
      projectStage: ProjectStage.Slab,
      stageLabel: "Slab",
    },
    recorder.db,
    async () => {
      order.push("xero");
      return { fields: stageInvoiceFields(), xeroInvoiceId: "xero_1" };
    },
  );

  assert.deepEqual(invoice, { id: "inv_1" });
  // The durable trace exists before the money call, which is the whole point:
  // an accepted invoice whose response is lost still left a row to find.
  assert.deepEqual(order, ["intent:invoice-stage:p_1:Slab", "xero"]);
});

test("a stage with no agreed claim invoices nothing and records no intent", async () => {
  const recorder = recordingDb({
    "project.findUnique": {
      ...STAGE_PROJECT,
      requirements: { commercialsAndClaims: { paymentStages: [] } },
      totalBudget: 0,
    },
  });
  let called = 0;
  const invoice = await createStageInvoice(
    {
      issuedDate: new Date("2026-10-01T00:00:00.000Z"),
      projectId: "p_1",
      projectStage: ProjectStage.Slab,
      stageLabel: "Slab",
    },
    recorder.db,
    async () => {
      called += 1;
      return { fields: stageInvoiceFields(), xeroInvoiceId: "xero_1" };
    },
  );
  assert.equal(invoice, null);
  assert.equal(called, 0);
  assert.deepEqual(recorder.writes(), []);
});

test("a replayed stage claim re-reads the invoice instead of the stored result", async () => {
  let xeroCalls = 0;
  const recorder = recordingDb({
    "project.findUnique": STAGE_PROJECT,
    "outboxEvent.upsert": {
      id: "effect_1",
      key: "invoice-stage:p_1:Slab",
      result: { invoiceId: "inv_1", xeroInvoiceId: "xero_1" },
      status: OutboxEventStatus.SUCCEEDED,
    },
    "invoice.findUnique": { id: "inv_1", total: "100000" },
  });

  const invoice = await createStageInvoice(
    {
      issuedDate: new Date("2026-10-01T00:00:00.000Z"),
      projectId: "p_1",
      projectStage: ProjectStage.Slab,
      stageLabel: "Slab",
    },
    recorder.db,
    async () => {
      xeroCalls += 1;
      return { fields: stageInvoiceFields(), xeroInvoiceId: "xero_1" };
    },
  );

  assert.equal(xeroCalls, 0, "a replay must not raise a second claim");
  // Decimals and Dates come back off the row, not out of stored JSON.
  assert.deepEqual(invoice, { id: "inv_1", total: "100000" });
});

/* ------------------------------------------------ role reconciliation -- */

test("a Clerk/local role divergence leaves a durable row", async () => {
  let recorded: unknown;
  const recorder = recordingDb({
    "outboxEvent.upsert": (args: unknown) => {
      recorded = args;
      return {
        id: "effect_1",
        key: (args as { where: { key: string } }).where.key,
        result: null,
        status: OutboxEventStatus.PENDING,
      };
    },
  });

  const { key } = await recordRoleReconciliation(recorder.db, {
    clerkRole: "SITE_MANAGER",
    clerkUserId: "user_abc",
    detectedAt: new Date("2026-09-21T09:00:00.000Z"),
    localRole: "ADMIN",
    reason: "The last admin cannot be demoted.",
    userId: "u_1",
  });

  assert.equal(
    key,
    "team-role-reconciliation:user_abc:2026-09-21T09:00:00.000Z",
  );
  const payload = (recorded as { create: { payload: Record<string, unknown> } })
    .create.payload;
  // Both sides of the disagreement, so whoever picks it up can see which is
  // which without guessing.
  assert.equal(payload.clerkRole, "SITE_MANAGER");
  assert.equal(payload.localRole, "ADMIN");
  assert.equal(payload.reason, "The last admin cannot be demoted.");
});

test("open reconciliations are administrator-only and exclude settled ones", async () => {
  let query: unknown;
  const recorder = recordingDb({
    "outboxEvent.findMany": (args: unknown) => {
      query = args;
      return [];
    },
  });
  await listRoleReconciliations(adminPrincipal(), recorder.db);
  assert.deepEqual(
    (query as { where: { status: { in: string[] } } }).where.status.in,
    [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED],
  );

  await assert.rejects(
    () => listRoleReconciliations(customerPrincipal(), recordingDb().db),
    (error) => error instanceof Error,
  );
});

test("closing a reconciliation twice is refused, not silently accepted", async () => {
  await resolveRoleReconciliation(
    adminPrincipal(),
    "team-role-reconciliation:user_abc:2026-09-21T09:00:00.000Z",
    recordingDb({ "outboxEvent.updateMany": { count: 1 } }).db,
    "Clerk put back to ADMIN.",
  );

  await assert.rejects(
    () =>
      resolveRoleReconciliation(
        adminPrincipal(),
        "team-role-reconciliation:user_abc:2026-09-21T09:00:00.000Z",
        recordingDb({ "outboxEvent.updateMany": { count: 0 } }).db,
        "Clerk put back to ADMIN.",
      ),
    DomainNotFoundError,
  );
});
