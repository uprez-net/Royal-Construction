import { cronOutcome, withCronReporting } from "@/lib/observability/cron";
import { WhatsAppMediaSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { isDomainError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import { reconcileWhatsAppBridgeMappings } from "@/lib/domain/projects/whatsapp/group-links";
import { findPendingWhatsAppMedia } from "@/lib/domain/whatsapp/media";
import prisma from "@/lib/prisma";
import { createWhatsAppBridgePortFromEnv } from "@/lib/whatsapp-bridge/client";
import { readWhatsAppConfig } from "@/lib/whatsapp/config";
import { storeWhatsAppMediaFiles } from "@/lib/workflow/whatsapp-media";

/**
 * Daily: finish WhatsApp work whose workflow never started or never finished,
 * and keep the bridge's list of groups in step with the app's.
 *
 * - Files still PENDING an hour after they arrived (the webhook could not
 *   start the copy, or the run died) are handed to the media workflow again —
 *   a lead's from Meta, a project group's from the WhatsApp bridge.
 * - The bridge's mapped groups are replaced with the projects' linked ones,
 *   so a link or unlink the bridge missed is repaired within a day.
 *
 * Nothing here repeats an effect: the media copy is idempotent per file, and
 * replacing the mappings sets a state.
 */

const PRINCIPAL = systemPrincipal("cron:whatsapp-sweep");
const MEDIA_GRACE_MS = 60 * 60 * 1000;
const BATCH = 50;

export const maxDuration = 120;

async function handle(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    if (!cronSecret) {
      console.error("[whatsapp-sweep] cron: CRON_SECRET is not configured.");
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const meta = readWhatsAppConfig();
  const bridge = createWhatsAppBridgePortFromEnv();
  if (!meta.enabled && !bridge) {
    return NextResponse.json({
      skipped: "Neither WhatsApp nor the WhatsApp bridge is configured.",
    });
  }

  const media = await findPendingWhatsAppMedia(prisma, {
    limit: BATCH,
    olderThan: new Date(Date.now() - MEDIA_GRACE_MS),
    // Only files this runtime can fetch.
    sources: [
      ...(meta.enabled ? [WhatsAppMediaSource.META] : []),
      ...(bridge ? [WhatsAppMediaSource.BRIDGE] : []),
    ],
  });
  let mediaRun: string | null = null;
  if (media.length > 0) {
    mediaRun = (await start(storeWhatsAppMediaFiles, [media])).runId;
  }

  let mappings: Awaited<
    ReturnType<typeof reconcileWhatsAppBridgeMappings>
  > | null = null;
  let failed = 0;
  if (bridge) {
    try {
      mappings = await reconcileWhatsAppBridgeMappings(PRINCIPAL, prisma, {
        bridge,
      });
    } catch (error) {
      failed += 1;
      console.error(
        `[whatsapp-sweep] Could not resync the WhatsApp bridge's groups${isDomainError(error) ? `: ${error.message}` : "."}`,
        isDomainError(error) ? undefined : error,
      );
    }
  }

  console.info(
    `[whatsapp-sweep] media ${media.length}; bridge mappings ${mappings ? JSON.stringify(mappings) : bridge ? "failed" : "not configured"}`,
  );
  // A failed resync is counted, not thrown, so the run answers 200. Tell the
  // wrapper, or its monitor check-in closes as a success.
  return cronOutcome(
    NextResponse.json({ mappings, media: media.length, mediaRun }),
    { failed },
  );
}

export const GET = withCronReporting("/api/cron/whatsapp-sweep", handle);
