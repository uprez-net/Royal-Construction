import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { test } from "vitest";

import { disconnectXero } from "@/lib/domain/integrations/xero";
import { DomainAuthorizationError } from "@/lib/domain/errors";
import { recordingDb } from "./domain-harness";

const admin = { kind: "user" as const, role: Role.ADMIN, userId: "u_admin" };
const customer = {
  kind: "user" as const,
  role: Role.CUSTOMER,
  userId: "u_customer",
};

test("Xero disconnect deactivates locally even when the token is already dead", async () => {
  const recorder = recordingDb({
    "xeroConnection.findFirst": {
      accessToken: "access",
      id: "xero_1",
      refreshToken: "refresh",
      tenantName: "Royal Construction",
    },
    "xeroConnection.updateMany": { count: 1 },
  });
  const result = await disconnectXero(admin, recorder.db, async () => {
    throw new Error("invalid_grant");
  });

  assert.deepEqual(result, {
    connectionId: "xero_1",
    disconnected: true,
    revocationFailed: true,
    tenantName: "Royal Construction",
  });
  assert.deepEqual(
    (recorder.writes()[0].args as { data: unknown; where: unknown }).data,
    { isActive: false },
  );
});

test("Xero disconnect is administrator-only", async () => {
  await assert.rejects(
    () => disconnectXero(customer, recordingDb().db, async () => undefined),
    DomainAuthorizationError,
  );
});
