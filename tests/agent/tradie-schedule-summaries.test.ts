import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

// The schedule and reschedule confirmations used to take their date from
// `toISOString()`, the UTC date. A booking for Fri 25 Sept is stored at Sydney
// midnight, which is 14:00 UTC on Thursday the 24th, so the summary told the
// model (and the office) the tradie started a day early.

const domain = vi.hoisted(() => ({
  createTradieSchedule: vi.fn(),
  getCreatedScheduleSummary: vi.fn(),
  rescheduleTradieSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/agent/lib/db", () => ({ agentDb: {} }));
vi.mock("@/agent/lib/actor", () => ({
  AgentAuthorizationError: class extends Error {},
  requireCurrentAgentActor: async () => ({ id: "user_1", role: "ADMIN" }),
}));
vi.mock("@/lib/domain/principal", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  userPrincipal: () => ({ kind: "user", userId: "user_1", role: "ADMIN" }),
}));
vi.mock("@/lib/domain/tradies/schedules", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createTradieSchedule: domain.createTradieSchedule,
  rescheduleTradieSchedule: domain.rescheduleTradieSchedule,
}));
vi.mock("@/lib/domain/tradies/queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCreatedScheduleSummary: domain.getCreatedScheduleSummary,
}));

const { createAuthorizedTradieSchedule, rescheduleAuthorizedTradie } =
  await import("@/agent/lib/tradie-operations");

const ctx = {} as never;
const id = "123e4567-e89b-42d3-a456-426614174000";
/** Fri 25 Sept 2026 00:00 AEST. */
const sydneyMidnight = new Date("2026-09-24T14:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

test("a new booking's summary gives the Sydney start date", async () => {
  domain.createTradieSchedule.mockResolvedValue({ id });
  domain.getCreatedScheduleSummary.mockResolvedValue({
    durationDays: 2,
    id,
    project: { id, name: "Lot 9028 Sommerville Dr" },
    quotedPrice: null,
    requiresQuote: false,
    scheduledDate: sydneyMidnight,
    status: "PENDING",
    tradie: { id, name: "AR Electrical" },
  });

  const result = await createAuthorizedTradieSchedule(ctx, {
    durationDays: 2,
    projectId: id,
    requiresQuote: false,
    scheduledDate: sydneyMidnight.toISOString(),
    tradieId: id,
  });

  assert.equal(
    result.summary,
    "AR Electrical is scheduled for Lot 9028 Sommerville Dr starting 2026-09-25.",
  );
});

test("a rescheduled booking's summary gives the Sydney start date", async () => {
  domain.rescheduleTradieSchedule.mockResolvedValue({
    durationDays: 2,
    notice: null,
    previousStatus: "PENDING",
    projectName: "Lot 9028 Sommerville Dr",
    scheduleId: id,
    scheduledDate: sydneyMidnight,
    status: "PENDING",
    tradieName: "AR Electrical",
    withdrewApproval: false,
  });

  const result = await rescheduleAuthorizedTradie(ctx, {
    scheduleId: id,
    scheduledDate: sydneyMidnight.toISOString(),
  });

  assert.equal(
    result.summary,
    "AR Electrical's booking for Lot 9028 Sommerville Dr now starts 2026-09-25.",
  );
});

test("a booking during daylight saving still lands on its Sydney date", async () => {
  // Mon 5 Oct 2026 00:00 AEDT is 13:00 UTC on Sunday the 4th.
  domain.rescheduleTradieSchedule.mockResolvedValue({
    durationDays: 1,
    notice: null,
    previousStatus: "PENDING",
    projectName: "Rose St",
    scheduleId: id,
    scheduledDate: new Date("2026-10-04T13:00:00.000Z"),
    status: "PENDING",
    tradieName: "AR Electrical",
    withdrewApproval: false,
  });

  const result = await rescheduleAuthorizedTradie(ctx, {
    scheduleId: id,
    scheduledDate: "2026-10-04T13:00:00.000Z",
  });

  assert.match(result.summary, /now starts 2026-10-05\.$/);
});
