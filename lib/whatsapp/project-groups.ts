import { start } from "workflow/api";

import { isDomainError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import {
  claimStalledProjectWhatsAppGroup,
  projectWhatsAppGroupAvailability,
  requestProjectWhatsAppGroup,
} from "@/lib/domain/projects/whatsapp/groups";
import prisma from "@/lib/prisma";
import { whatsappChannelFromEnv } from "@/lib/whatsapp/config";
import { createProjectWhatsAppGroup } from "@/lib/workflow/whatsapp-group";

// The App's side of starting a project's WhatsApp group: the domain decides
// (lib/domain/projects/whatsapp/groups.ts), this starts the workflow that
// talks to Meta. App-only — Eve records a request and the App starts it.

/**
 * After a project is created: ask for its group, when groups are on.
 *
 * Never throws. A project is created whether or not WhatsApp cooperates; a
 * request that could not be recorded or started shows on the project header,
 * where the office can try again, and the daily sweep starts anything left.
 */
export async function requestWhatsAppGroupForNewProject(
  projectId: string,
): Promise<void> {
  const channel = whatsappChannelFromEnv();
  if (!projectWhatsAppGroupAvailability(channel).available) return;
  try {
    const result = await requestProjectWhatsAppGroup(
      systemPrincipal("project-created"),
      { projectId },
      prisma,
      { channel },
    );
    if (result.start) {
      await start(createProjectWhatsAppGroup, [result.group.id]);
    }
  } catch (error) {
    console.error(
      `[whatsapp] Could not request a WhatsApp group for project ${projectId}${isDomainError(error) ? `: ${error.message}` : "."}`,
      isDomainError(error) ? undefined : error,
    );
  }
}

/** Start the create workflow for a group row the domain just asked for. */
export async function startProjectWhatsAppGroupWorkflow(
  groupRowId: string,
): Promise<void> {
  await start(createProjectWhatsAppGroup, [groupRowId]);
}

/** Restart a request that was recorded but never sent, at most every two minutes. */
export async function restartStalledProjectWhatsAppGroup(
  groupRowId: string,
): Promise<void> {
  try {
    const claimed = await claimStalledProjectWhatsAppGroup(
      systemPrincipal("project-whatsapp-kick"),
      { groupRowId },
      prisma,
    );
    if (claimed) await start(createProjectWhatsAppGroup, [groupRowId]);
  } catch (error) {
    console.error(
      "[whatsapp] Could not restart a stalled group request.",
      error,
    );
  }
}
