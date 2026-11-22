import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const calls: unknown[] = [];
let outcome: { success: boolean } = { success: true };
let admins: string[] = ["a1"];

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/domain/identity/users", () => ({
  findAdminUserIds: async () => admins,
}));
vi.mock("@/lib/domain/tradies/invoice-inbox", () => ({
  staleInvoiceReminders: async () => [
    { count: 2, oldestDays: 6, projectId: "p1", projectName: "Alpha" },
    { count: 1, oldestDays: 3, projectId: "p2", projectName: "Beta" },
  ],
}));
vi.mock("@/lib/notification/novu", () => ({
  triggerNotification: async (...args: unknown[]) => {
    calls.push(args);
    return outcome;
  },
}));

import { remindStaleInvoices } from "@/lib/jobs/stale-invoice-reminder";

beforeEach(() => {
  calls.length = 0;
  outcome = { success: true };
  admins = ["a1"];
});

test("each due project is sent to the admins", async () => {
  assert.deepEqual(await remindStaleInvoices(new Date()), { failed: 0, reminded: 2 });
  assert.equal(calls.length, 2);
});

test("a { success: false } answer counts as failed, not reminded", async () => {
  outcome = { success: false };
  assert.deepEqual(await remindStaleInvoices(new Date()), { failed: 2, reminded: 0 });
});

test("with no admins nobody is told (an empty list would mean everyone)", async () => {
  admins = [];
  assert.deepEqual(await remindStaleInvoices(new Date()), { failed: 0, reminded: 0 });
  assert.equal(calls.length, 0);
});
