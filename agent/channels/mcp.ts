import { createClerkClient } from "@clerk/backend";
import { oauthResource } from "eve/channels/auth";
import { mcpChannel } from "eve/channels/mcp";
import prisma from "@/lib/prisma";
import {
  MCP_ROUTE,
  createMcpUserAuth,
  isValidMcpResourceUrl,
  mcpResourceConfig,
} from "@/agent/lib/mcp-auth-policy";
import { isAgentFeatureEnabled } from "@/agent/lib/session-identity";
import { principalForClerkId } from "@/lib/domain/identity/users";

// The one authenticated MCP transport into Eve, replacing the hand-written
// (mcp) route group (issue #303). It publishes Eve's four durable invocation
// tools — agent_start, agent_get, agent_update, agent_cancel — rather than a
// second tool-per-table registry, so an external client reaches the same
// orchestrator, the same specialists and the same lib/domain commands as the
// /agent workspace, with one set of approval, idempotency and audit rules
// behind them. docs/eve-mcp-endpoint.md is the client-facing contract.

const clerkClient = createClerkClient({
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
});

/**
 * Clerk OAuth access tokens only.
 *
 * Clerk's tokens are opaque, so they are verified by introspection through
 * @clerk/backend — which is Node-clean, unlike @clerk/nextjs and the
 * @clerk/mcp-tools package the deprecated route used. `oauth_token` is also
 * the only credential an external MCP client can obtain interactively:
 * Clerk's authorization server supports dynamic client registration, so a
 * hosted client registers itself the first time somebody connects.
 *
 * First-party session tokens are deliberately not accepted. Nothing in the
 * product speaks MCP — the workspace uses the browser channel in
 * agent/channels/eve.ts — so accepting them would add a second credential
 * path to the surface this change exists to reduce.
 */
async function clerkUserIdFor(request: Request): Promise<string | null> {
  const requestState = await clerkClient.authenticateRequest(request, {
    acceptsToken: "oauth_token",
  });
  if (!requestState.isAuthenticated) return null;
  return requestState.toAuth().userId;
}

const auth = createMcpUserAuth({
  clerkUserIdFor,
  isEnabled: isAgentFeatureEnabled,
  principalFor: (clerkUserId) => principalForClerkId(clerkUserId, prisma),
});

// Read when this module is evaluated, which for the route table is `eve
// build`, not the first request: whether the OAuth discovery routes exist at
// all is decided there. NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is present in every
// environment that builds this app (Next inlines it), so this resolves; the
// warning is here because the alternative failure is silent -- an endpoint
// that 401s without ever telling a client where to sign in.
const resource = mcpResourceConfig();

if (
  process.env.EVE_MCP_RESOURCE?.trim()
  && !isValidMcpResourceUrl(process.env.EVE_MCP_RESOURCE.trim())
) {
  console.warn(
    "[eve/mcp] EVE_MCP_RESOURCE must be an HTTPS URL without credentials, "
      + "query, or fragment (HTTP is allowed only on loopback). Falling back "
      + "to NEXT_PUBLIC_APP_URL when it is usable.",
  );
}

if (!resource) {
  console.warn(
    "[eve/mcp] No Clerk publishable key at build time, so /eve/v1/mcp is "
      + "published without OAuth discovery. External clients will get a bare "
      + "401 with nowhere to sign in. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "
      + "(or EVE_MCP_ISSUER) and rebuild.",
  );
}

export default mcpChannel({
  // Without an authorization server to advertise, nothing can authenticate
  // anyway, so the endpoint still answers a bare 401 rather than pointing
  // clients at a sign-in that does not exist.
  auth: resource ? oauthResource(auth, resource) : auth,
  route: MCP_ROUTE,
});
