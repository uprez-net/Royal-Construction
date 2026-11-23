import { cronOutcome, withCronReporting } from "@/lib/observability/cron";
import { NextResponse } from "next/server";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { matchProjectWithModel } from "@/lib/comms/project-call-matcher";
import { matchWaitingCallsToProjects } from "@/lib/domain/comms/calls/project-matching";
import { systemPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";

/**
 * Every six hours: file the inbound calls Mili or the voicemail took
 * onto the project each was about, so an owner, tradie or site manager
 * ringing about a build shows up on that build's Calls with an unread badge.
 *
 * Candidates come from the caller's number; the model only reads the
 * transcript to choose among them (lib/domain/comms/calls/project-matching.ts).
 * Nothing here contacts anybody, and filing is conditional on the call still
 * being unfiled, so an overlapping run is harmless.
 */

const PRINCIPAL = systemPrincipal("cron:project-call-matching");

// Up to a batch of model calls, each with its own timeout.
export const maxDuration = 300;
// Stop starting new calls well before maxDuration; the rest wait for the
// next run, still unfiled.
const RUN_BUDGET_MS = 240_000;

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret
    || request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    if (!cronSecret)
      console.error(
        "[project-call-matching] cron: CRON_SECRET is not configured.",
      );
    return new Response("Unauthorized", { status: 401 });
  }
  if (!commsRuntimeFromEnv().config.callsEnabled) {
    return NextResponse.json({ skipped: "Calls are not enabled." });
  }
  const totals = await matchWaitingCallsToProjects(
    PRINCIPAL,
    prisma,
    { matchProject: matchProjectWithModel },
    { deadline: Date.now() + RUN_BUDGET_MS },
  );
  console.info(`[project-call-matching] ${JSON.stringify(totals)}`);
  // A call that could not be read is retried next run; one that ran out of
  // attempts is an incident.
  return cronOutcome(NextResponse.json(totals), { failed: totals.failed });
}

export const GET = withCronReporting("/api/cron/project-call-matching", handle);
