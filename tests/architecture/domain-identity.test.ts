import assert from "node:assert/strict";

import { Role } from "@prisma/client";
import { test } from "vitest";

import { updateUserByClerkId } from "@/lib/domain/identity/users";
import { recordingDb } from "./domain-harness";

test("a repeated CUSTOMER update reuses the linked customer", async () => {
  const recorder = recordingDb({
    "user.update": {
      clerkId: "clerk_1",
      customerId: "customer_1",
      email: "owner@example.com",
      id: "user_1",
      name: "Owner",
      phone: "0400000000",
      role: Role.CUSTOMER,
    },
  });

  const result = await updateUserByClerkId(
    "clerk_1",
    { email: "owner@example.com", role: Role.CUSTOMER },
    recorder.transactionalDb,
  );

  assert.equal(result.customerId, "customer_1");
  assert.deepEqual(recorder.operations(), ["user.update"]);
});

test("the first CUSTOMER update creates and links one customer", async () => {
  const recorder = recordingDb({
    "customer.create": { id: "customer_1" },
    "user.update": (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      return "clerkId" in where
        ? {
            customerId: null,
            email: "owner@example.com",
            id: "user_1",
            name: "Owner",
            phone: "0400000000",
            role: Role.CUSTOMER,
          }
        : {};
    },
  });

  const result = await updateUserByClerkId(
    "clerk_1",
    { role: Role.CUSTOMER },
    recorder.transactionalDb,
  );

  assert.equal(result.customerId, "customer_1");
  assert.deepEqual(recorder.operations(), [
    "user.update",
    "customer.create",
    "user.update",
  ]);
});
