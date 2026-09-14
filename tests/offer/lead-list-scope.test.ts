import { test } from "node:test";
import assert from "node:assert/strict";
import type { Role } from "@prisma/client";

import { canAccessLead, leadListScope } from "../../lib/offer/access";
import { toOfferListRow } from "../../lib/offer/offer-listing-query";

// The offers listing read every lead's offers with no session check. Its
// Server Action answered anyone who replayed it, and a signed-in CUSTOMER saw
// offers the offer page would refuse to open. The listing now applies the
// offer page's own rule through leadListScope, and each revision it ships is
// narrowed by toOfferListRow instead of spreading the whole Offer row.

const INTERNAL_ROLES: Role[] = ["ADMIN", "SITE_MANAGER", "GUEST"];

test("internal roles list every lead", () => {
  for (const role of INTERNAL_ROLES) {
    assert.deepEqual(leadListScope({ id: "u1", role }), { assignedId: null });
  }
});

test("a customer lists only the leads assigned to them", () => {
  assert.deepEqual(leadListScope({ id: "u1", role: "CUSTOMER" }), {
    assignedId: "u1",
  });
});

test("the listing scope admits exactly the leads canAccessLead admits", () => {
  const leads = [
    { id: 1, assignedId: "u1" },
    { id: 2, assignedId: "u2" },
    { id: 3, assignedId: null },
  ];
  for (const role of [...INTERNAL_ROLES, "CUSTOMER"] as Role[]) {
    const user = { id: "u1", role };
    const scope = leadListScope(user);
    for (const lead of leads) {
      const listed =
        scope.assignedId === null || lead.assignedId === scope.assignedId;
      assert.equal(listed, canAccessLead(user, lead), `${role}, lead ${lead.id}`);
    }
  }
});

test("toOfferListRow ships no workspaceState or agreedSnapshot", () => {
  // A full Offer row, as an `include` would have returned it.
  const stored = {
    id: "offer-1",
    leadId: 7,
    baseReference: "RC-0042",
    revisionNumber: 2,
    isActive: true,
    offerStatus: "SENT" as const,
    amount: "100.00",
    gstAmount: "10.00",
    totalAmount: "110.00",
    contractValueIncGst: "110.00",
    sentAt: new Date("2026-01-02T00:00:00Z"),
    acceptedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    workspaceState: { schemaVersion: 1, secret: "cost build-up" },
    agreedSnapshot: { frozen: true },
    executedPdfUrl: "https://blob.example/offer.pdf",
  };

  const row = toOfferListRow(stored, 3);

  assert.equal("workspaceState" in row, false);
  assert.equal("agreedSnapshot" in row, false);
  assert.deepEqual(Object.keys(row).sort(), [
    "acceptedAt",
    "amount",
    "baseReference",
    "contractValueIncGst",
    "createdAt",
    "gstAmount",
    "id",
    "isActive",
    "leadId",
    "offerStatus",
    "revisionNumber",
    "sentAt",
    "totalAmount",
    "updatedAt",
    "version",
  ]);
  // A priced row keeps its stored amounts; the repair only touches $0 rows.
  assert.equal(row.totalAmount, "110.00");
  assert.equal(row.amount, "100.00");
  assert.equal(row.version, 3);
});
