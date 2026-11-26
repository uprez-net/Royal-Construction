import { NextResponse } from "next/server";

import { armOwnerCallTimers } from "@/lib/comms/owner-call-timers";
import { withCronReporting } from "@/lib/observability/cron";
import prisma from "@/lib/prisma";

/**
 * Hourly backstop for scheduled owner calls (lib/domain/comms/calls/
 * owner-call.ts). Each call already has a timer, a durable sleep started when
 * Hermes scheduled it; this re-arms every call due within the next 70
 * minutes, overdue ones included, so a timer that never started still rings
 * on time (or is dropped as missed once half an hour late). A duplicate timer
 * is harmless: only one can claim the call.
 *
 * Not a per-minute poll of due calls: that would keep the database awake
 * around the clock. This runs at :15, beside the approval-expiry cron, so it
 * adds no wake-up of its own.
 */

const HORIZON_MS = 70 * 60 * 1000;

export const maxDuration = 60;

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret
    || request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    if (!cronSecret)
      console.error("[owner-calls] cron: CRON_SECRET is not configured.");
    return new Response("Unauthorized", { status: 401 });
  }
  const armed = await armOwnerCallTimers(
    { dueBefore: new Date(Date.now() + HORIZON_MS) },
    prisma,
  );
  if (armed) console.info(`[owner-calls] armed ${armed} timer(s)`);
  return NextResponse.json({ armed });
}

export const GET = withCronReporting("/api/cron/owner-calls", handle);
