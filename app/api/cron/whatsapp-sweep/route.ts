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
 * - Groups still CREATING are checked: one never sent to Meta gets its create
 *   workflow, one sent but unconfirmed is resolved — found, or failed with a
 *   reason — so nothing sits "being created" for ever.
 *
 * Nothing here repeats an effect: the media copy is idempotent per file and
 * the group create is behind an outbox key.
 */

const PRINCIPAL = systemPrincipal("cron:whatsapp-sweep");
const MEDIA_GRACE_MS = 60 * 60 * 1000;
const BATCH = 50;

export const maxDuration = 120;

export async function GET(request: Request) {
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
      if (group.submitted) {
        ({ outcome } = await resolveCreatingProjectWhatsAppGroup(
          PRINCIPAL,
          { groupRowId: group.id },
          prisma,
          { groups: port?.groups ?? null },
        ));
      } else {
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
  return NextResponse.json({
    groups: groupOutcomes,
    media: media.length,
    mediaRun,
  });
}
