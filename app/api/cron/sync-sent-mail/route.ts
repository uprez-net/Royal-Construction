import { withCronReporting } from "@/lib/observability/cron";
import { start } from "workflow/api";
import { NextResponse } from "next/server";

import { parseStrictIsoDateTime } from "@/lib/dates/iso-datetime";
import { syncSentMail } from "@/lib/workflow/sent-mail-sync";

/**
 * Daily: copy what was sent from Outlook onto the trails in the app.
 *
 * Only enqueues the run. Reading Sent Items and storing attachments is
 * lib/workflow/sent-mail-sync.ts, where each message is a step of its own.
 */

// Two days, for a job that runs every day: a missed or failed run is covered
// by the next one. Overlap costs nothing — every message already on a trail is
// recognised and skipped.
const DEFAULT_WINDOW_MS = 48 * 60 * 60 * 1000;

// How far back `?since=` may reach, for a backfill run by hand.
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  // An unset secret refuses everyone, rather than letting "Bearer undefined"
  // through.
  if (
    process.env.NODE_ENV === "production"
    && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)
  ) {
    if (!cronSecret) {
      console.error("[sent-mail-sync] cron: CRON_SECRET is not configured.");
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  const requested = new URL(request.url).searchParams.get("since");
  let since = new Date(now - DEFAULT_WINDOW_MS);
  if (requested) {
    const parsed = parseStrictIsoDateTime(requested);
    if (
      !parsed
      || parsed.getTime() > now
      || now - parsed.getTime() > MAX_WINDOW_MS
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "since must be an ISO date and time with a zone (2026-11-01T00:00:00Z) within the last 31 days.",
        },
        { status: 400 },
      );
    }
    since = parsed;
  }

  try {
    const run = await start(syncSentMail, [{ since: since.toISOString() }]);
    console.log(
      `[sent-mail-sync] cron: run ${run.runId} started for Sent Items since ${since.toISOString()}`,
    );
    // The run id stays in the log: it is the capability the resume-stream
    // route reads a run with, so no response hands one out bare.
    return NextResponse.json({ success: true, since: since.toISOString() });
  } catch (error) {
    console.error("[sent-mail-sync] cron: could not start the run", error);
    return NextResponse.json(
      { success: false, error: "Could not start the sent-mail sync." },
      { status: 500 },
    );
  }
}

export const GET = withCronReporting("/api/cron/sync-sent-mail", handle);
