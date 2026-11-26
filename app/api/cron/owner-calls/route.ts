import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { startHandoffDeliveries } from "@/lib/comms/owner-call-handoffs";
import { armOwnerCallTimers } from "@/lib/comms/owner-call-timers";
import { recoverStalePlacingOwnerCalls } from "@/lib/domain/comms/calls/owner-call";
import { handoffsToDeliver } from "@/lib/domain/comms/calls/owner-call-handoff";
import { systemPrincipal } from "@/lib/domain/principal";
import { withCronReporting } from "@/lib/observability/cron";
import prisma from "@/lib/prisma";

/**
 * Hourly backstop for scheduled owner calls (lib/domain/comms/calls/
 * owner-call.ts). Each call already has a timer, a durable sleep started when
 * Hermes scheduled it; this re-arms every call due within the next 70
 * minutes, overdue ones included, so a timer that never started still rings
 * on time (or is dropped as missed once half an hour late). A duplicate timer
 * is harmless: only one can claim the call. A call left mid-placement (its
 * claim still PLACING) is settled first, so one sent back to SCHEDULED is
 * armed in the same run.
 *
 * It is the backstop for post-call handoffs to Hermes too
 * (lib/domain/comms/calls/owner-call-handoff.ts): a placed call that ended
 * without its handoff being marked ready is marked, and every handoff whose
 * delivery run was lost, cut off or failed is started again, until the
 * domain's attempt limit. One that never gets through stays FAILED: shown
 * under Admin → Agent calls and listed for Hermes.
 *
 * Not a per-minute poll of due calls: that would keep the database awake
 * around the clock. This runs at :15, beside the approval-expiry cron, so it
 * adds no wake-up of its own.
 */

const HORIZON_MS = 70 * 60 * 1000;

export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret
    || !authorized(request.headers.get("authorization"), cronSecret)
  ) {
    if (!cronSecret)
      console.error("[owner-calls] cron: CRON_SECRET is not configured.");
    return new Response("Unauthorized", { status: 401 });
  }
  const recovered = await recoverStalePlacingOwnerCalls(
    systemPrincipal("cron:owner-calls"),
    {},
    prisma,
  );
  if (recovered.length) {
    console.info(
      `[owner-calls] sent ${recovered.length} stalled call(s) back to scheduled`,
    );
  }
  const armed = await armOwnerCallTimers(
    { dueBefore: new Date(Date.now() + HORIZON_MS) },
    prisma,
  );
  if (armed) console.info(`[owner-calls] armed ${armed} timer(s)`);
  const handoffs = await handoffsToDeliver(
    systemPrincipal("cron:owner-calls"),
    {},
    prisma,
  );
  const delivering = await startHandoffDeliveries(handoffs);
  if (delivering) {
    console.info(
      `[owner-calls] started delivering ${delivering} handoff(s) to Hermes`,
    );
  }
  return NextResponse.json({ armed, handoffs: delivering });
}

export const GET = withCronReporting("/api/cron/owner-calls", handle);
