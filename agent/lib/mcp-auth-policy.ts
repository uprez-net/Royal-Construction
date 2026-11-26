import { createHash, timingSafeEqual } from "node:crypto";

import type { Role } from "@prisma/client";
import type { AuthFn } from "eve/channels/auth";
import { ForbiddenError, withAuthChallenges } from "eve/channels/auth";

import { isOfficeRole } from "@/lib/domain/principal";

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
 * `offline_access`.
 *
 * `openid` has to be in the list. A client registers itself with Clerk through
 * dynamic client registration, and Clerk records the scopes it registered; a
 * client that then asks to authorize with `openid` — several hosted clients
 * add it to every OAuth flow because they treat Clerk as an OIDC provider —
 * is refused with `invalid_scope: The OAuth 2.0 Client is not allowed to
 * request scope 'openid'`. Advertising it makes those clients register for it.
 * It only adds an ID token; the access token this endpoint verifies is
 * unchanged, and nothing here reads a claim beyond the Clerk subject.
 */
export const MCP_SCOPES = ["openid", "profile", "email"] as const;

const PUBLISHABLE_KEY_PREFIX = /^pk_(test|live)_/;
const FRONTEND_API_HOST =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Matches Eve's OAuth resource URL rules before calling oauthResource(). */
export function isValidMcpResourceUrl(
  value: string | undefined | null,
): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    const loopback = isLoopbackHostname(url.hostname);
    return (
      (url.protocol === "https:" || (url.protocol === "http:" && loopback))
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
    );
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return true;
  }

  const octets = host.split(".").map(Number);
  return (
    octets.length === 4
    && octets.every(
      (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
    )
    && octets[0] === 127
  );
}

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
  /** Omitted only when nothing configured one; Eve then reads the request. */
  readonly resource?: string;
  readonly scopes: readonly string[];
}

/**
 * The OAuth protected-resource metadata this channel publishes, or null when
 * no Clerk instance is configured — in which case nothing could authenticate
 * anyway, and advertising an authorization server would be a lie.
 *
 * `resource` is configured rather than read off the request, because the
 * request does not carry the client-facing origin here. `withEve` reaches the
 * agent by proxying to a separate server, so under `next dev` the request URL
 * is the internal one and Eve advertises `http://127.0.0.1:<port>/eve/v1/mcp`
 * — an identifier no client can use, in the one field the whole OAuth
 * exchange is keyed on.
 *
 * So: `EVE_MCP_RESOURCE` when a gateway needs it stated outright, otherwise
 * the app's own public URL, which is already configured and already means
 * exactly this. Only with neither does it fall back to the request.
 */
export function mcpResourceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): McpResourceConfig | null {
  const issuer =
    env.EVE_MCP_ISSUER?.trim()
    || clerkIssuerFromPublishableKey(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!issuer) return null;

  const configuredResource = env.EVE_MCP_RESOURCE?.trim();
  const resource =
    (isValidMcpResourceUrl(configuredResource) ? configuredResource : null)
    || mcpResourceFromAppUrl(env.NEXT_PUBLIC_APP_URL);

  return {
    issuer,
    metadataPath: MCP_METADATA_PATH,
    ...(resource ? { resource } : {}),
    scopes: MCP_SCOPES,
  };
}

/** `<app origin>/eve/v1/mcp`, or null when the app URL is unset or unusable. */
function mcpResourceFromAppUrl(appUrl: string | undefined): string | null {
  const configured = appUrl?.trim();
  if (!configured) return null;

  try {
    const resource = new URL(MCP_ROUTE, new URL(configured).origin).toString();
    return isValidMcpResourceUrl(resource) ? resource : null;
  } catch {
    return null;
  }
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
  /**
   * HERMES_MCP_SECRET: the secret only Hermes (the owner's assistant, on its
   * own server) sends, in HERMES_SECRET_HEADER, beside its Clerk token. Null:
   * no caller is ever Hermes.
   */
  readonly hermesSecret?: () => string | null;
}

/** Where Hermes sends HERMES_MCP_SECRET on every MCP request. */
export const HERMES_SECRET_HEADER = "x-hermes-secret";

/**
 * The session attribute that marks a caller as Hermes, so the owner-call
 * tools (agent/tools/owner_calls.ts) resolve for it and for nobody else.
 * Auth attributes are strings.
 */
export const HERMES_ATTRIBUTE = "hermes";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Does this request carry Hermes's secret? Constant-time over digests, so
 * neither the length nor a prefix leaks. Absent or unset is simply "no".
 */
export function carriesHermesSecret(
  request: Request,
  secret: string | null | undefined,
): boolean {
  const sent = request.headers.get(HERMES_SECRET_HEADER)?.trim();
  if (!secret || !sent) return false;
  return timingSafeEqual(digest(sent), digest(secret));
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
      // Office only, as on the browser channel (agent/lib/channel-auth.ts):
      // the office digest and recall index every lead, offer and price.
      if (!principal || !isOfficeRole(principal.role)) {
        throw new ForbiddenError({
          code: "agent_access_denied",
          message: "The operations agent is unavailable for this account.",
        });
      }

      // Hermes signs in as an office user like anyone else; the secret only
      // adds the owner-call tools on top of that user's ordinary access. A
      // wrong secret is not a refusal: the caller is just not Hermes.
      const hermes = carriesHermesSecret(request, deps.hermesSecret?.());
      return {
        attributes: {
          role: principal.role,
          ...(hermes ? { [HERMES_ATTRIBUTE]: "true" } : {}),
        },
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
