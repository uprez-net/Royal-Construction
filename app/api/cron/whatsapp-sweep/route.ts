import { cronOutcome, withCronReporting } from "@/lib/observability/cron";
import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { systemPrincipal } from "@/lib/domain/principal";
import {
  findUnresolvedProjectWhatsAppGroups,
  resolveCreatingProjectWhatsAppGroup,
} from "@/lib/domain/projects/whatsapp/groups";
import { findPendingWhatsAppMedia } from "@/lib/domain/whatsapp/media";
import prisma from "@/lib/prisma";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import { readWhatsAppConfig } from "@/lib/whatsapp/config";
import { storeWhatsAppMediaFiles } from "@/lib/workflow/whatsapp-media";
import { createProjectWhatsAppGroup } from "@/lib/workflow/whatsapp-group";

/**
 * Daily: finish WhatsApp work whose workflow never started or never finished.
 *
 * - Files still PENDING an hour after they arrived (the webhook could not
 *   start the copy, or the run died) are handed to the media workflow again.
 * - Groups still CREATING are resolved — found, or failed with a reason once
 *   past the deadline — so nothing sits "being created" for ever. One never
 *   sent to Meta and still inside the deadline gets its create workflow.
 *
 * Nothing here repeats an effect: the media copy is idempotent per file and
 * the group create is behind an outbox key.
 */

const PRINCIPAL = systemPrincipal("cron:whatsapp-sweep");
const MEDIA_GRACE_MS = 60 * 60 * 1000;
const BATCH = 50;

export const maxDuration = 120;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (
    process.env.NODE_ENV === "production"
    && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)
  ) {
    if (!cronSecret) {
      console.error("[whatsapp-sweep] cron: CRON_SECRET is not configured.");
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const config = readWhatsAppConfig();
  if (!config.enabled) {
    return NextResponse.json({ skipped: "WhatsApp is not enabled." });
  }

  const media = await findPendingWhatsAppMedia(prisma, {
    limit: BATCH,
    olderThan: new Date(Date.now() - MEDIA_GRACE_MS),
  });
  let mediaRun: string | null = null;
  if (media.length > 0) {
    mediaRun = (await start(storeWhatsAppMediaFiles, [media])).runId;
  }

  const groups = await findUnresolvedProjectWhatsAppGroups(prisma, {
    limit: BATCH,
  });
  const port = createWhatsAppPortFromEnv();
  const groupOutcomes: Record<string, number> = {};
  for (const group of groups) {
    let outcome: string;
    try {
      // The domain decides first — including that an unsent request past its
      // deadline has failed — and only one still worth waiting on is started.
      ({ outcome } = await resolveCreatingProjectWhatsAppGroup(
        PRINCIPAL,
        { groupRowId: group.id },
        prisma,
        { groups: port?.groups ?? null },
      ));
      if (!group.submitted && outcome === "waiting") {
        await start(createProjectWhatsAppGroup, [group.id]);
        outcome = "started";
      }
    } catch (error) {
      console.error("[whatsapp-sweep] Could not settle a group.", error);
      outcome = "error";
    }
    groupOutcomes[outcome] = (groupOutcomes[outcome] ?? 0) + 1;
  }

  console.info(
    `[whatsapp-sweep] media ${media.length}; groups ${JSON.stringify(groupOutcomes)}`,
  );
  // A group that could not be settled is counted, not thrown, so the run
  // answers 200. Tell the wrapper, or its monitor check-in closes as a success.
  return cronOutcome(
    NextResponse.json({
      groups: groupOutcomes,
      media: media.length,
      mediaRun,
    }),
    { failed: groupOutcomes.error ?? 0 },
  );
}

export const GET = withCronReporting("/api/cron/whatsapp-sweep", handle);
