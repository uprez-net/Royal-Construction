import type { Role } from "@prisma/client";
import type { AuthFn } from "eve/channels/auth";
import { ForbiddenError, withAuthChallenges } from "eve/channels/auth";

// The inbound MCP channel's authentication policy and its public resource
// identity, with no Clerk client and no Prisma connection in sight — those
// arrive as dependencies from agent/channels/mcp.ts. Keeping them out is what
// lets tests/agent/mcp-channel-auth.test.ts exercise the five outcomes the
// endpoint can produce without a database or a network round trip.
//
// The policy itself is deliberately the same shape as the browser channel's
// (agent/lib/channel-auth.ts): resolve a Clerk subject, map it to an
// application User, and hand Eve a `principalType: "user"` principal carrying
// the application id. That is the identity the event persister writes sessions
// under, requireCurrentAgentActor reads back, and runAuditedAgentOperation
// re-checks — so an external MCP caller and the /agent workspace reach the
// domain as the same person, under the same audit trail.

/** Streamable HTTP endpoint. Eve's default; named here because we reference it. */
export const MCP_ROUTE = "/eve/v1/mcp";

/**
 * Where the RFC 9728 protected-resource metadata is actually served.
 *
 * Eve would derive `/.well-known/oauth-protected-resource/eve/v1/mcp` from the
 * resource path, and that is the path a client constructs for itself. It
 * cannot work here: this agent is mounted inside a Next.js app, and both
 * `withEve`'s dev rewrite and the Vercel service route it generates match
 * `/eve/v1/*` and nothing else, so a document outside that prefix never
 * reaches the agent at all.
 *
 * So the document is published under the prefix that does route, and
 * next.config.ts redirects the canonical path to it. Eve puts this same path
 * in the `resource_metadata` parameter of its Bearer challenge, which is how a
 * compliant MCP client discovers it; the redirect is for clients that go
 * straight to the well-known URL instead.
 */
export const MCP_METADATA_PATH = `${MCP_ROUTE}/.well-known/oauth-protected-resource`;

/**
 * Scopes advertised to clients. Clerk's authorization server supports
 * `openid`, `profile`, `email`, `public_metadata`, `private_metadata` and
 * `offline_access`; the deprecated route advertised `profile` and `email`, and
 * nothing here reads a narrower claim, so the replacement advertises the same
 * two rather than inventing a scope Clerk would reject.
 */
export const MCP_SCOPES = ["profile", "email"] as const;

const PUBLISHABLE_KEY_PREFIX = /^pk_(test|live)_/;
const FRONTEND_API_HOST =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Clerk's authorization server, derived from the publishable key.
 *
 * The key is `pk_(test|live)_` followed by the base64 Frontend API host with a
 * `$` terminator. That host publishes the OAuth authorization-server metadata,
 * the JWKS and — the part that matters for a hosted MCP client — the dynamic
 * client registration endpoint. Deriving it keeps the issuer in step with
 * whichever Clerk instance the deployment is already pointed at instead of
 * adding a second setting that can disagree with the first.
 */
export function clerkIssuerFromPublishableKey(
  publishableKey: string | undefined | null,
): string | null {
  const key = publishableKey?.trim();
  if (!key || !PUBLISHABLE_KEY_PREFIX.test(key)) return null;

  const host = Buffer.from(key.replace(PUBLISHABLE_KEY_PREFIX, ""), "base64")
    .toString("utf8")
    .replace(/\$+$/, "")
    .trim();

  // Buffer.from does not reject malformed base64, it returns rubbish, so the
  // host shape is what actually validates the key.
  return FRONTEND_API_HOST.test(host) ? `https://${host}` : null;
}

export interface McpResourceConfig {
  readonly issuer: string;
  readonly metadataPath: string;
  /** Omitted when Eve should derive it from the request origin. */
  readonly resource?: string;
  readonly scopes: readonly string[];
}

/**
 * The OAuth protected-resource metadata this channel publishes, or null when
 * no Clerk instance is configured — in which case nothing could authenticate
 * anyway, and advertising an authorization server would be a lie.
 *
 * `resource` is left unset so Eve reads the public identifier off the request,
 * which is correct behind Vercel. Set `EVE_MCP_RESOURCE` when a gateway
 * rewrites the client-facing origin or path, because then the request no
 * longer carries the identifier the client used.
 */
export function mcpResourceConfig(
  env: NodeJS.ProcessEnv = process.env,
): McpResourceConfig | null {
  const issuer =
    env.EVE_MCP_ISSUER?.trim()
    || clerkIssuerFromPublishableKey(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!issuer) return null;

  const resource = env.EVE_MCP_RESOURCE?.trim();

  return {
    issuer,
    metadataPath: MCP_METADATA_PATH,
    ...(resource ? { resource } : {}),
    scopes: MCP_SCOPES,
  };
}

export interface McpAuthPrincipal {
  readonly role: Role;
  readonly userId: string;
}

export interface McpAuthDependencies {
  /**
   * The Clerk subject behind this request's credential, or null when there is
   * no credential or the credential does not verify. Null is "keep walking",
   * not "reject": Eve's auth walk turns an exhausted walk into the 401 that
   * carries the Bearer challenge and the protected-resource metadata URL.
   */
  readonly clerkUserIdFor: (request: Request) => Promise<string | null>;
  /** The application principal for a Clerk subject, or null when unregistered. */
  readonly principalFor: (
    clerkUserId: string,
  ) => Promise<McpAuthPrincipal | null>;
  readonly isEnabled: () => boolean;
}

export function createMcpUserAuth(deps: McpAuthDependencies): AuthFn<Request> {
  return withAuthChallenges(
    async (request) => {
      if (!deps.isEnabled()) {
        throw new ForbiddenError({
          code: "agent_disabled",
          message: "The operations agent is not enabled for this environment.",
        });
      }

      const clerkUserId = await deps.clerkUserIdFor(request);
      if (!clerkUserId) return null;

      // A Clerk account with no application User row is a refusal, not a skip.
      // Falling through would report it as a bad credential and send the client
      // back to sign in again, which cannot fix it; the account needs a row.
      const principal = await deps.principalFor(clerkUserId);
      if (!principal) {
        throw new ForbiddenError({
          code: "agent_access_denied",
          message: "The operations agent is unavailable for this account.",
        });
      }

      return {
        attributes: { role: principal.role },
        authenticator: "clerk",
        issuer: "clerk",
        principalId: principal.userId,
        principalType: "user",
        subject: clerkUserId,
      };
    },
    [{ scheme: "Bearer" }],
  );
}
