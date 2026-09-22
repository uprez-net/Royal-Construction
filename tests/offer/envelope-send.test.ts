import assert from "node:assert/strict";
import { test } from "vitest";

import { envelopeSignatureRows } from "@/lib/domain/offers/envelope-send";

test("unknown DocuSign recipient ids stay unknown for webhook email fallback", () => {
  const rows = envelopeSignatureRows([
    {
      email: "owner-one@example.test",
      name: "Owner One",
      recipientId: "",
      role: "CUSTOMER",
      routingOrder: 1,
    },
    {
      email: "owner-two@example.test",
      name: "Owner Two",
      recipientId: "",
      role: "CUSTOMER",
      routingOrder: 1,
    },
  ]);

  assert.deepEqual(
    rows.map((row) => row.docusignRecipientId),
    [null, null],
  );
});

test("known DocuSign recipient ids remain available for exact matching", () => {
  const [row] = envelopeSignatureRows([
    {
      email: "builder@example.test",
      name: "Royal Constructions",
      recipientId: "builder-42",
      role: "BUILDER",
      routingOrder: 2,
    },
  ]);

  assert.equal(row?.docusignRecipientId, "builder-42");
  assert.equal(row?.recipientRole, "BUILDER");
});
