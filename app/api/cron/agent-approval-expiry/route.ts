import {
  eveSessionUrl,
  expiryRequestBody,
  expiryRequestHeaders,
} from "@/lib/agent/approval-expiry-wire";
import { expireStaleApprovals } from "@/lib/domain/agent/approvals";
import { systemPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { cronOutcome, withCronReporting } from "@/lib/observability/cron";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse } from "@/utils/validators";

/**
 * Withdraws Eve approvals nobody answered in time (#617).
 *
 * An approval used to stay answerable for ever, so a change approved a
 * fortnight late ran against the record as it was that day, and four of the
 * first six approval waits in production ended with nothing written and
 * nothing on screen saying so. Each run cancels, through eve, every approval
 * past the end of the next working day after it was asked for
 * (lib/domain/agent/approval-expiry.ts). The specialist then ends its task
 * with "Not done: the approval expired", and an audit row records it.
 */
async function withdraw(
  rootEveSessionId: string,
  requests: readonly { requestId: string; toolName: string }[],
) {
  const url = eveSessionUrl(rootEveSessionId);
  const headers = expiryRequestHeaders();
  if (!url || !headers) {
    throw new Error(
      "The Eve endpoint is not configured (NEXT_PUBLIC_APP_URL and CRON_SECRET or AGENT_EFFECTS_SECRET).",
    );
  }
  const response = await fetch(url, {
    body: JSON.stringify(expiryRequestBody(requests)),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Logged by the caller, per conversation; the run closes its monitor
    // check-in as an error through `cronOutcome`.
    throw new Error(
      `Eve answered ${response.status} to an approval withdrawal.`,
    );
  }
}

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return errorResponse("Cron not configured", {
      status: 500,
      code: "CONFIG_ERROR",
    });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return errorResponse("Unauthorized", { status: 401, code: "UNAUTHORIZED" });
  }

  try {
    const outcome = await expireStaleApprovals(
      systemPrincipal("cron:agent-approval-expiry"),
      {},
      prisma,
      { withdraw },
    );
    return cronOutcome(
      successResponse({ message: "Approval expiry ran.", ...outcome }),
      { failed: outcome.failed },
    );
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("[CRON_ERROR] agent-approval-expiry failed:", error);
    return errorResponse("Failed to expire agent approvals", {
      status: 500,
      code: "CRON_ERROR",
    });
  }
}

export const GET = withCronReporting("/api/cron/agent-approval-expiry", handle);
