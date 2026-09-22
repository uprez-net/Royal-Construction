import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { test } from "node:test";

import {
  authorizeEmailAttachmentDeletion,
  sendCampaignEmail,
} from "../../lib/domain/email/operations";
import { DomainAuthorizationError } from "../../lib/domain/errors";

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
    () => sendCampaignEmail(customer, { body: "x", subject: "x", to: "a@b.com" }, async () => {}),
    DomainAuthorizationError,
  );
});
