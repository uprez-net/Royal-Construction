import { commsRuntimeFromEnv } from "@/lib/comms/factory";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { isInternalPrincipal } from "@/lib/domain/principal";
import { forbiddenResponse, successResponse, unauthorizedResponse } from "@/utils/validators/response";

/**
 * The SMS and phone configuration, without secrets, for the admin page:
 * which provider is active, its numbers, what is available, and every
 * misconfiguration the reader found.
 */
export async function GET() {
  const principal = await signedInUserPrincipal();
  if (!principal) return unauthorizedResponse();
  if (!isInternalPrincipal(principal)) return forbiddenResponse();
  const runtime = commsRuntimeFromEnv();
  const { config, channel } = runtime;
  return successResponse({
    activeProvider: config.provider,
    browserCalling: channel?.browserCalling ?? false,
    callsAvailable: channel?.callsAvailable ?? false,
    callsEnabled: config.callsEnabled,
    capabilities: channel ? runtime.adapterFor(channel.provider).capabilities : null,
    numbers: config.numbers,
    problems: config.problems,
    recordingMode: config.recordingMode,
    smsAvailable: channel?.smsAvailable ?? false,
    smsEnabled: config.smsEnabled,
    staffForwardNumber: config.staffForwardNumber,
    webhookOrigin: config.webhookOrigin,
  });
}
