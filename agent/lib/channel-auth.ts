import type { AuthFn } from "eve/channels/auth";
import { createClerkClient } from "@clerk/backend";
import {
  ForbiddenError,
  UnauthenticatedError,
  withAuthChallenges,
} from "eve/channels/auth";
import prisma from "@/lib/prisma";
import {
  getEveSessionIdFromRequest,
  isAgentFeatureEnabled,
} from "@/agent/lib/session-identity";
import { waitForOwnedAgentSession } from "@/agent/lib/session-owner";
import { findAgentSessionOwner } from "@/lib/domain/access/agent-sessions";
import { principalForClerkId } from "@/lib/domain/identity/users";

const clerkClient = createClerkClient({
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
});

// Null means "not registered yet", not "no owner" — see
// lib/domain/access/agent-sessions.ts. waitForOwnedAgentSession waits that
// race out; a row that exists with a foreign owner is refused immediately.
async function findSessionOwner(eveSessionId: string) {
  const session = await findAgentSessionOwner(eveSessionId, prisma);
  return session?.ownerUserId ?? null;
}

export function clerkInternalUserAuth(): AuthFn<Request> {
  return withAuthChallenges(
    async (request) => {
      if (!isAgentFeatureEnabled()) {
        throw new ForbiddenError({
          code: "agent_disabled",
          message: "The operations agent is not enabled for this environment.",
        });
      }

      const requestState = await clerkClient.authenticateRequest(request, {
        acceptsToken: "session_token",
      });
      if (!requestState.isAuthenticated) {
        throw new UnauthenticatedError({
          code: "authentication_required",
          message: "Sign in to use the operations agent.",
        });
      }

      const clerkAuth = requestState.toAuth();
      if (!clerkAuth.isAuthenticated || !clerkAuth.userId) {
        throw new UnauthenticatedError({
          code: "authentication_required",
          message: "Sign in to use the operations agent.",
        });
      }

      const user = await principalForClerkId(clerkAuth.userId, prisma);
      if (!user) {
        throw new ForbiddenError({
          code: "agent_access_denied",
          message: "The operations agent is unavailable for this account.",
        });
      }

      const eveSessionId = getEveSessionIdFromRequest(request);
      if (eveSessionId) {
        const ownsSession = await waitForOwnedAgentSession(
          findSessionOwner,
          eveSessionId,
          user.userId,
        );
        if (!ownsSession) {
          throw new ForbiddenError({
            code: "agent_session_access_denied",
            message: "The requested agent session is unavailable.",
          });
        }
      }

      return {
        attributes: {
          role: user.role,
        },
        authenticator: "clerk",
        issuer: "clerk",
        principalId: user.userId,
        principalType: "user",
        subject: clerkAuth.userId,
      };
    },
    [{ scheme: "Bearer" }],
  );
}
