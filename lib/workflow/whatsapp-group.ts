import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { FatalError, sleep } from "workflow";

import { isDomainError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import {
  resolveCreatingProjectWhatsAppGroup,
  submitProjectWhatsAppGroupCreate,
} from "@/lib/domain/projects/whatsapp/groups";
import prisma from "@/lib/prisma";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";

/**
 * Creates a project's WhatsApp group and waits for WhatsApp to confirm it.
 *
 * Meta answers a create with a request id and confirms on a webhook later.
 * The webhook normally finishes the job (lib/domain/projects/whatsapp/
 * groups.ts → applyWhatsAppGroupEvent); this run also checks on a widening
 * timer, so a webhook that never arrives — the field not subscribed, a
 * delivery lost — still ends with the group active or with a reason it is
 * not, inside half an hour.
 */

const PRINCIPAL = systemPrincipal("workflow:whatsapp-group");

/** Seconds between checks: quick at first, then patient. */
const CHECKS = [20, 40, 60, 120, 240, 480, 900] as const;

async function submit(groupRowId: string): Promise<string> {
  "use step";
  try {
    const { outcome } = await submitProjectWhatsAppGroupCreate(
      PRINCIPAL,
      { groupRowId },
      prisma,
      { groups: createWhatsAppPortFromEnv()?.groups ?? null },
    );
    return outcome;
  } catch (error) {
    // The create is behind an outbox key: a replayed step cannot ask Meta
    // twice, but nor would retrying a refusal help.
    throw new FatalError(
      isDomainError(error)
        ? error.message
        : "Creating the WhatsApp group failed.",
    );
  }
}
// One attempt: a second create is exactly what the outbox exists to stop.
submit.maxRetries = 0;

async function resolve(groupRowId: string): Promise<string> {
  "use step";
  const { outcome } = await resolveCreatingProjectWhatsAppGroup(
    PRINCIPAL,
    { groupRowId },
    prisma,
    { groups: createWhatsAppPortFromEnv()?.groups ?? null },
  );
  return outcome;
}

export const createProjectWhatsAppGroup = async (
  groupRowId: string,
): Promise<string> => {
  "use workflow";
  try {
    return await runCreateProjectWhatsAppGroup(groupRowId);
  } catch (error) {
    await reportWorkflowError("createProjectWhatsAppGroup", error);
    throw error;
  }
};

// The body, split out so the workflow function above can report a run that
// fails once its steps are out of retries. A plain function: it runs in the
// same sandbox and calls its steps exactly as before.
const runCreateProjectWhatsAppGroup = async (
  groupRowId: string,
): Promise<string> => {
  const submitted = await submit(groupRowId);
  if (submitted === "refused" || submitted === "not_creating") return submitted;
  if (submitted === "created") return "active";

  for (const seconds of CHECKS) {
    await sleep(`${seconds}s`);
    const outcome = await resolve(groupRowId);
    if (outcome !== "waiting") return outcome;
  }
  // Past every check; the resolver's own deadline marks it failed on the
  // sweep's next pass if WhatsApp still has said nothing.
  return "waiting";
};
