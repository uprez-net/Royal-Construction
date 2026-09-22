import assert from "node:assert/strict";

import { LeadStage, OfferStatus, OutboxEventStatus } from "@prisma/client";
import { test } from "vitest";

import {
  OfferProposalSendError,
  sendOfferProposal,
} from "@/lib/domain/offers/proposal-send";
import { adminPrincipal, recordingDb } from "./domain-harness";

const MESSAGE = {
  attachments: [],
  body: "Your proposal",
  subject: "Royal Constructions proposal",
  to: "owner@example.test",
};

function authorizedOfferReads(status: OfferStatus) {
  let read = 0;
  return () => {
    read += 1;
    if (read === 1) return { isActive: true, leadId: 7 };
    if (read === 2) return { offerStatus: status };
    return {
      lead: { stage: LeadStage.QUOTED, wonAt: null },
      leadId: 7,
      offerStatus: OfferStatus.SENT,
    };
  };
}

test("a replayed proposal attempt never emails the customer again", async () => {
  let sends = 0;
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": authorizedOfferReads(OfferStatus.SENT),
    "outboxEvent.upsert": {
      id: "effect_1",
      key: "offer-proposal:offer_1:attempt_1:owner@example.test",
      result: { accepted: true, recipientEmail: "owner@example.test" },
      status: OutboxEventStatus.SUCCEEDED,
    },
  });

  const result = await sendOfferProposal(
    adminPrincipal(),
    {
      attemptId: "attempt_1",
      offerFileVersion: 3,
      offerId: "offer_1",
      recipients: [
        { email: "owner@example.test", message: MESSAGE, token: "token_1" },
      ],
    },
    recorder.transactionalDb,
    { send: async () => void (sends += 1) },
  );

  assert.equal(sends, 0);
  assert.deepEqual(result.replayedEmails, ["owner@example.test"]);
  assert.ok(
    !recorder.operations().includes("offerDocumentSend.create"),
    "a replay wrote a second tracking row",
  );
});

test("a partial proposal delivery locks the offer as sent", async () => {
  let sends = 0;
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": authorizedOfferReads(OfferStatus.PENDING),
    "offer.updateMany": { count: 1 },
    "outboxEvent.findUnique": (args: unknown) => ({
      attempts: 0,
      id: `effect_${sends + 1}`,
      key: (args as { where: { key: string } }).where.key,
      kind: "OFFER_DOCUMENT_SEND",
      payload: {},
      status: OutboxEventStatus.PENDING,
    }),
    "outboxEvent.updateMany": { count: 1 },
    "outboxEvent.upsert": (args: unknown) => ({
      id: `effect_${sends + 1}`,
      key: (args as { where: { key: string } }).where.key,
      result: null,
      status: OutboxEventStatus.PENDING,
    }),
  });

  await assert.rejects(
    () =>
      sendOfferProposal(
        adminPrincipal(),
        {
          attemptId: "attempt_partial",
          offerFileVersion: 4,
          offerId: "offer_1",
          recipients: [
            {
              email: "owner@example.test",
              message: MESSAGE,
              token: "token_1",
            },
            {
              email: "partner@example.test",
              message: { ...MESSAGE, to: "partner@example.test" },
              token: "token_2",
            },
          ],
        },
        recorder.transactionalDb,
        {
          send: async () => {
            sends += 1;
            if (sends === 2) throw new Error("provider refused recipient two");
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof OfferProposalSendError);
      assert.deepEqual(error.deliveredEmails, ["owner@example.test"]);
      return true;
    },
  );

  const statusWrite = recorder
    .writes()
    .find((call) => call.operation === "offer.updateMany");
  assert.deepEqual(
    (statusWrite?.args as { data?: { offerStatus?: OfferStatus } }).data
      ?.offerStatus,
    OfferStatus.SENT,
  );
  assert.equal(sends, 2);
});
