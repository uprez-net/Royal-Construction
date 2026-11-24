import type { AuthFn } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
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
import { isOfficeRole } from "@/lib/domain/principal";
import {
  APPROVAL_EXPIRY_SERVICE,
  claimsApprovalExpiryService,
  verifyApprovalExpiryRequest,
} from "@/lib/agent/approval-expiry-wire";

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

      // The one request a cron may make here: withdrawing approvals that
      // expired unanswered (#617). Verified on the bearer, the path and a
      // body that only cancels; see lib/agent/approval-expiry-wire.ts. A
      // request that claims to be the service and fails any of those is
      // refused outright rather than tried as a sign-in.
      if (claimsApprovalExpiryService(request)) {
        const eveSessionId = await verifyApprovalExpiryRequest(request);
        if (!eveSessionId) {
          throw new UnauthenticatedError({
            code: "service_authentication_failed",
            message: "The service request could not be verified.",
          });
        }
        const service: SessionAuthContext = {
          attributes: {},
          authenticator: "guri-service",
          issuer: "guri",
          principalId: APPROVAL_EXPIRY_SERVICE,
          principalType: "service",
          subject: APPROVAL_EXPIRY_SERVICE,
        };
        return service;
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
      // The office digest and `recall_crm_context` index every lead, offer and
      // price, and the specialists act on them. A site manager has the project
      // screens, not this.
      if (!user || !isOfficeRole(user.role)) {
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
