import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { FatalError, RetryableError, getStepMetadata } from "workflow";

import { vercelBlobPut } from "@/lib/blob-port";
import { isDomainError, DomainSideEffectError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import { storeWhatsAppMedia } from "@/lib/domain/whatsapp/media";
import prisma from "@/lib/prisma";
import { createCloudApiMediaPort } from "@/lib/whatsapp/cloud-api";
import { readWhatsAppConfig } from "@/lib/whatsapp/config";

/**
 * Copies inbound WhatsApp files into Blob storage.
 *
 * Started by the webhook once a delivery is committed, by the retry button
 * on a failed file, and by the daily sweep for anything left PENDING. Each
 * file is its own step, so one slow download does not hold up the rest, and
 * a step the runtime replays finds the file STORED and does nothing — the
 * domain (lib/domain/whatsapp/media.ts) decides, this only drives it.
 */

const PRINCIPAL = systemPrincipal("workflow:whatsapp-media");

async function storeOne(mediaId: string): Promise<string> {
  "use step";
  const config = readWhatsAppConfig();
  try {
    const result = await storeWhatsAppMedia(
      PRINCIPAL,
      { maxBytes: config.mediaMaxBytes, mediaId },
      prisma,
      { download: createCloudApiMediaPort(config), put: vercelBlobPut },
    );
    return result.outcome;
  } catch (error) {
    if (error instanceof DomainSideEffectError && error.retryable) {
      // Back off: Meta's media endpoint and Blob both recover in seconds to
      // minutes, and the domain gives up on its own after MAX_MEDIA_ATTEMPTS.
      const { attempt } = getStepMetadata();
      throw new RetryableError(error.message, {
        retryAfter: Math.min(10_000 * attempt ** 2, 5 * 60_000),
      });
    }
    // Not configured here, not on record, or a bug: retrying cannot help.
    // The file stays as the domain left it, and the sweep looks again.
    throw new FatalError(
      isDomainError(error) ? error.message : "Storing a WhatsApp file failed.",
    );
  }
}
// Five attempts in all, matching MAX_MEDIA_ATTEMPTS in the domain. A literal on
// purpose: reading the constant here would pull the domain module — and
// @prisma/client — into the workflow sandbox, which refuses Node packages.
storeOne.maxRetries = 4;

// The workflow body stays to steps and literals: it runs in the workflow
// sandbox, which replays it, and has no business loading Prisma.
export const storeWhatsAppMediaFiles = async (
  mediaIds: string[],
): Promise<string[]> => {
  "use workflow";
  try {
    return await runStoreWhatsAppMediaFiles(mediaIds);
  } catch (error) {
    await reportWorkflowError("storeWhatsAppMediaFiles", error);
    throw error;
  }
};

// The body, split out so the workflow function above can report a run that
// fails once its steps are out of retries. A plain function: it runs in the
// same sandbox and calls its steps exactly as before.
const runStoreWhatsAppMediaFiles = async (
  mediaIds: string[],
): Promise<string[]> => {
  const outcomes: string[] = [];
  for (const mediaId of mediaIds) {
    try {
      outcomes.push(await storeOne(mediaId));
    } catch {
      // One file failing must not strand the others in the same delivery.
      outcomes.push("error");
    }
  }
  return outcomes;
};
