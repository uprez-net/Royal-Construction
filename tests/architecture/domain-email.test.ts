import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { test } from "vitest";

import {
  authorizeEmailAttachmentDeletion,
  sendCampaignEmail,
} from "@/lib/domain/email/operations";
import type { DomainDb } from "@/lib/domain/db";
import { DomainAuthorizationError } from "@/lib/domain/errors";

const admin = { kind: "user" as const, role: Role.ADMIN, userId: "u_admin" };
const customer = {
  kind: "user" as const,
  role: Role.CUSTOMER,
  userId: "u_customer",
};

test("email attachment deletion accepts only the composer namespace", () => {
  assert.deepEqual(
    authorizeEmailAttachmentDeletion(
      admin,
      "https://store.public.blob.vercel-storage.com/email-ad-hock-attachment-upload/file.pdf",
    ),
    {
      blobUrl:
        "https://store.public.blob.vercel-storage.com/email-ad-hock-attachment-upload/file.pdf",
    },
  );
  assert.throws(
    () =>
      authorizeEmailAttachmentDeletion(
        admin,
        "https://store.public.blob.vercel-storage.com/projects/file.pdf",
      ),
    DomainAuthorizationError,
  );
});

test("campaign email is staff-only and sends to the normalized recipient", async () => {
  let sent: unknown;
  const result = await sendCampaignEmail(
    admin,
    { body: "Hello", subject: "Update", to: "  customer@example.com " },
    async (input) => {
      sent = input;
    },
  );
  assert.deepEqual(result, { alreadySent: false, sent: true });
  assert.deepEqual(sent, {
    body: "Hello",
    subject: "Update",
    to: "customer@example.com",
  });
  await assert.rejects(
    () =>
      sendCampaignEmail(
        customer,
        { body: "x", subject: "x", to: "a@b.com" },
        async () => {},
      ),
    DomainAuthorizationError,
  );
});

function historyDb() {
  const created: { data: Record<string, unknown> }[] = [];
  const db = {
    leadHistory: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args);
        return args;
      },
    },
  } as unknown as DomainDb;
  return { created, db };
}

test("a campaign email for a lead is recorded on that lead's history (#297)", async () => {
  const { created, db } = historyDb();
  const result = await sendCampaignEmail(
    admin,
    { body: "Hi", leadId: 42, subject: "Spring update", to: "a@b.com" },
    async () => {},
    db,
  );

  assert.deepEqual(result, { alreadySent: false, sent: true });
  assert.equal(created.length, 1);
  assert.equal(created[0].data.leadId, 42);
  assert.equal(created[0].data.action, "Email sent");
  assert.equal(created[0].data.detail, "Subject: Spring update");
  assert.equal(created[0].data.type, "EMAIL");
  assert.equal(created[0].data.authorId, "u_admin");
  assert.ok(created[0].data.actionDate instanceof Date);
});

test("a campaign email with no lead id writes no history", async () => {
  const { created, db } = historyDb();
  await sendCampaignEmail(
    admin,
    { body: "Hi", subject: "Spring update", to: "a@b.com" },
    async () => {},
    db,
  );
  assert.equal(created.length, 0);
});

test("an email that failed to send is not recorded as sent", async () => {
  const { created, db } = historyDb();
  await assert.rejects(() =>
    sendCampaignEmail(
      admin,
      { body: "Hi", leadId: 42, subject: "x", to: "a@b.com" },
      async () => {
        throw new Error("graph down");
      },
      db,
    ),
  );
  assert.equal(created.length, 0);
});

test("a failed history write never turns a delivered email into a failure", async () => {
  const db = {
    leadHistory: {
      create: async () => {
        throw new Error("db down");
      },
    },
  } as unknown as DomainDb;
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await sendCampaignEmail(
      admin,
      { body: "Hi", leadId: 42, subject: "x", to: "a@b.com" },
      async () => {},
      db,
    );
    assert.deepEqual(result, { alreadySent: false, sent: true });
  } finally {
    console.error = originalError;
  }
});
