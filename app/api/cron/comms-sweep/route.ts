import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import {
  pruneCommsWebhookEvents,
  reconcileStaleCalls,
} from "@/lib/domain/comms/calls/reconcile";
import { recordingsNeedingWork } from "@/lib/domain/comms/calls/recordings";
import { systemPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";
import { storeCallRecordings } from "@/lib/workflow/call-recording";

/**
 * Daily: settle calls whose final callback never arrived, and finish
 * recordings whose copy never started or whose carrier copy was never
 * deleted. Nothing here repeats an effect a customer sees: reconciliation
 * only asks the carrier, and a recording copy is idempotent per recording.
 */

const PRINCIPAL = systemPrincipal("cron:comms-sweep");

export const maxDuration = 120;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    process.env.NODE_ENV === "production"
    && (!cronSecret
      || request.headers.get("authorization") !== `Bearer ${cronSecret}`)
  ) {
    if (!cronSecret)
      console.error("[comms-sweep] cron: CRON_SECRET is not configured.");
    return new Response("Unauthorized", { status: 401 });
  }
  const runtime = commsRuntimeFromEnv();
  if (!runtime.config.smsEnabled && !runtime.config.callsEnabled) {
    return NextResponse.json({ skipped: "SMS and calls are not enabled." });
  }
  const calls = await reconcileStaleCalls(PRINCIPAL, prisma, {
    voiceFor: runtime.voiceFor,
  });
  const recordings = await recordingsNeedingWork(prisma);
  const pruned = await pruneCommsWebhookEvents(PRINCIPAL, prisma);
  const recordingRun =
    recordings.length > 0
      ? (await start(storeCallRecordings, [recordings])).runId
      : null;
  console.info(
    `[comms-sweep] calls ${JSON.stringify(calls)}; pruned ${pruned}; recordings ${recordings.length}${recordingRun ? ` (run ${recordingRun})` : ""}`,
  );
  return NextResponse.json({
    calls,
    pruned,
    recordingRun,
    recordings: recordings.length,
  });
}
