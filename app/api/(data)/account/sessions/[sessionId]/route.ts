import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

import { clerkClient } from "@/lib/auth";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Sign one of the caller's own devices out (DELETE).
 *
 * Signing a device out is sensitive, so a session that has not confirmed
 * itself recently gets Clerk's reverification answer; the page's
 * `useVerifiedAction` shows its "Confirm it's you" dialog and retries.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId: targetId } = await params;
  const { userId, sessionId, has } = await auth();
  if (!userId) return unauthorizedResponse();
  if (!has({ reverification: "strict" })) {
    return reverificationErrorResponse("strict");
  }
  if (targetId === sessionId) {
    return errorResponse("Use Sign out to end the session on this device.", {
      code: "ACCOUNT_SESSION_IS_CURRENT",
      status: 400,
    });
  }

  try {
    const target = await clerkClient.sessions
      .getSession(targetId)
      .catch((error: unknown) => {
        if ((error as { status?: unknown })?.status === 404) return null;
        throw error;
      });
    // Someone else's session is answered exactly like a missing one.
    if (!target || target.userId !== userId) {
      return errorResponse("That device is no longer signed in.", {
        code: "ACCOUNT_SESSION_NOT_FOUND",
        status: 404,
      });
    }
    await clerkClient.sessions.revokeSession(targetId);
    return successResponse({ id: targetId });
  } catch (error) {
    console.error("[account] Signing a device out failed", error);
    return errorResponse("Could not sign that device out.", {
      code: "ACCOUNT_SESSION_REVOKE_FAILED",
      status: 502,
    });
  }
}
