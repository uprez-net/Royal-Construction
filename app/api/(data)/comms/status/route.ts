import { Role } from "@prisma/client";
import { connection } from "next/server";

import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { isInternalPrincipal } from "@/lib/domain/principal";
import {
  forbiddenResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The SMS and phone configuration, without secrets, for the admin page:
 * which provider is active, its numbers, what is available, and every
 * misconfiguration the reader found.
 *
 * Other staff get only whether calling and texting are available — enough
 * to show the buttons, nothing about numbers, origins or problems.
 */
export async function GET() {
  // Per request, never prerendered: the answer depends on who is asking.
  await connection();
  const principal = await signedInUserPrincipal();
  if (!principal) return unauthorizedResponse();
  if (!isInternalPrincipal(principal)) return forbiddenResponse();
  const runtime = commsRuntimeFromEnv();
  const { config, channel } = runtime;
  const availability = {
    callsAvailable: channel?.callsAvailable ?? false,
    smsAvailable: channel?.smsAvailable ?? false,
  };
  if (principal.role !== Role.ADMIN) return successResponse(availability);
  return successResponse({
    ...availability,
    activeProvider: config.provider,
    browserCalling: channel?.browserCalling ?? false,
    callsEnabled: config.callsEnabled,
    capabilities: channel
      ? runtime.adapterFor(channel.provider).capabilities
      : null,
    numbers: config.numbers,
    problems: config.problems,
    recordingMode: config.recordingMode,
    smsEnabled: config.smsEnabled,
    staffForwardNumber: config.staffForwardNumber,
    webhookOrigin: config.webhookOrigin,
  });
}
