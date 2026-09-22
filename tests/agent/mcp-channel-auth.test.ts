import assert from "node:assert/strict";
import { test } from "vitest";

import { type AuthFn, routeAuth } from "eve/channels/auth";

import {
  MCP_METADATA_PATH,
  MCP_ROUTE,
  MCP_SCOPES,
  type McpAuthDependencies,
  clerkIssuerFromPublishableKey,
  createMcpUserAuth,
  mcpResourceConfig,
} from "@/agent/lib/mcp-auth-policy";

// The MCP endpoint is the one Eve surface an outside client reaches, and it is
// on the open internet, so its refusals are worth pinning: which credential is
// rejected, which is refused, and what the caller becomes once it is accepted.
// The policy takes its Clerk client and its user lookup as dependencies (the
// real ones are wired in agent/channels/mcp.ts) so all of that is exercised
// here without a network round trip or a database connection.

const request = () => new Request("https://royal.test/eve/v1/mcp");

/** The 401/403 an auth refusal carries, or a failure if it did not refuse. */
async function refusalFrom(auth: AuthFn<Request>): Promise<Response> {
  try {
    await auth(request());
  } catch (caught) {
    const response = (caught as { response?: unknown }).response;
    assert.ok(response instanceof Response, "refusal carried no response");
    return response;
  }
  assert.fail("expected a refusal");
}

function deps(
  overrides: Partial<McpAuthDependencies> = {},
): McpAuthDependencies {
  return {
    clerkUserIdFor: async () => "user_clerk",
    isEnabled: () => true,
    principalFor: async () => ({ role: "ADMIN" as const, userId: "usr_1" }),
    ...overrides,
  };
}

/* ── the auth walk ─────────────────────────────────────────────────── */

test("a request with no usable credential falls through to Eve's 401", async () => {
  // Null, not a throw: Eve's auth walk turns an exhausted walk into the 401
  // that carries the Bearer challenge, and mcpChannel adds the
  // resource_metadata URL to it. Throwing here would lose that challenge.
  const auth = createMcpUserAuth(deps({ clerkUserIdFor: async () => null }));
  assert.equal(await Promise.resolve(auth(request())), null);
});

test("an invalid token is rejected exactly like a missing one", async () => {
  // Clerk verifies by introspection and reports both as "not authenticated",
  // and the endpoint must not tell an anonymous caller which it was.
  const auth = createMcpUserAuth(deps({ clerkUserIdFor: async () => null }));
  assert.equal(await Promise.resolve(auth(request())), null);
});

test("a Clerk account with no application user is refused, not retried", async () => {
  const response = await refusalFrom(
    createMcpUserAuth(deps({ principalFor: async () => null })),
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "agent_access_denied");
});

test("the rollout flag closes the endpoint before any credential is read", async () => {
  let reads = 0;
  const auth = createMcpUserAuth(
    deps({
      clerkUserIdFor: async () => {
        reads += 1;
        return "user_clerk";
      },
      isEnabled: () => false,
    }),
  );

  const response = await refusalFrom(auth);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "agent_disabled");
  assert.equal(reads, 0, "the disabled endpoint still called Clerk");
});

test("an accepted caller becomes the application user, not the Clerk subject", async () => {
  // This is what makes the MCP session the same principal as the workspace
  // one: the event persister writes AgentSession.ownerUserId from
  // principalId, requireCurrentAgentActor looks it up as a User.id, and Eve
  // binds invocation ownership to it. A Clerk id here would match no row.
  const auth = createMcpUserAuth(deps());
  const principal = await Promise.resolve(auth(request()));

  assert.deepEqual(principal, {
    attributes: { role: "ADMIN" },
    authenticator: "clerk",
    issuer: "clerk",
    principalId: "usr_1",
    principalType: "user",
    subject: "user_clerk",
  });
});

test("a rejected walk answers 401 with a Bearer challenge", async () => {
  // Run the real resolver Eve runs, rather than inspecting the AuthFn: an
  // unauthenticated MCP client has to be told a token scheme exists, and
  // mcpChannel appends the resource_metadata URL to whatever challenge comes
  // out of here.
  const auth = createMcpUserAuth(deps({ clerkUserIdFor: async () => null }));
  const resolved = await routeAuth(request(), auth);

  assert.ok(resolved instanceof Response, "expected a refusal response");
  assert.equal(resolved.status, 401);
  assert.match(resolved.headers.get("www-authenticate") ?? "", /^Bearer/);
});

test("an accepted walk returns the principal rather than a response", async () => {
  const resolved = await routeAuth(request(), createMcpUserAuth(deps()));

  assert.ok(!(resolved instanceof Response), "expected the caller's principal");
  assert.equal(resolved.principalId, "usr_1");
});

/* ── the published resource identity ───────────────────────────────── */

test("the issuer is derived from whichever Clerk instance is configured", () => {
  const key = `pk_test_${Buffer.from("present-grackle-89.clerk.accounts.dev$").toString("base64")}`;
  assert.equal(
    clerkIssuerFromPublishableKey(key),
    "https://present-grackle-89.clerk.accounts.dev",
  );

  const live = `pk_live_${Buffer.from("clerk.royal.example$").toString("base64")}`;
  assert.equal(
    clerkIssuerFromPublishableKey(live),
    "https://clerk.royal.example",
  );
});

test("a key that is missing or not a Clerk key yields no issuer", () => {
  // Buffer.from does not reject malformed base64, so a bad key decodes to
  // rubbish rather than throwing. Advertising an authorization server built
  // out of rubbish sends every client to a host that is not Clerk.
  for (const key of [
    undefined,
    null,
    "",
    "   ",
    "sk_test_abc",
    "pk_test_!!!!",
  ]) {
    assert.equal(
      clerkIssuerFromPublishableKey(key),
      null,
      `accepted ${String(key)}`,
    );
  }
});

test("the metadata path stays inside the prefix that reaches the agent", () => {
  // Only /eve/v1/* is routed to Eve, in dev by withEve's rewrite and in
  // production by the Vercel service route it generates. RFC 9728's derived
  // path sits outside it and would 404; next.config.ts redirects that path
  // here instead.
  assert.ok(
    MCP_METADATA_PATH.startsWith(`${MCP_ROUTE}/`),
    `${MCP_METADATA_PATH} would not reach the agent`,
  );
  assert.equal(
    MCP_METADATA_PATH,
    "/eve/v1/mcp/.well-known/oauth-protected-resource",
  );
});

const KEY = `pk_test_${Buffer.from("clerk.royal.example$").toString("base64")}`;

test("the resource identifier comes from the app's public URL", () => {
  // Not from the request: withEve proxies to a separate server, so under
  // `next dev` the request URL is http://127.0.0.1:<port>/... and Eve would
  // publish that as the resource every client keys its OAuth exchange on.
  assert.deepEqual(
    mcpResourceConfig({
      NEXT_PUBLIC_APP_URL: "https://royal.example",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY,
    }),
    {
      issuer: "https://clerk.royal.example",
      metadataPath: MCP_METADATA_PATH,
      resource: "https://royal.example/eve/v1/mcp",
      scopes: MCP_SCOPES,
    },
  );
});

test("a path or port on the app URL does not leak into the resource", () => {
  assert.equal(
    mcpResourceConfig({
      NEXT_PUBLIC_APP_URL: "https://royal.example/dashboard?tab=leads",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY,
    })?.resource,
    "https://royal.example/eve/v1/mcp",
  );
  assert.equal(
    mcpResourceConfig({
      NEXT_PUBLIC_APP_URL: "http://localhost:3111",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY,
    })?.resource,
    "http://localhost:3111/eve/v1/mcp",
  );
});

test("an explicit resource wins, for a gateway that rewrites the origin", () => {
  const overridden = mcpResourceConfig({
    EVE_MCP_ISSUER: "https://auth.royal.example",
    EVE_MCP_RESOURCE: "https://mcp.royal.example/eve/v1/mcp",
    NEXT_PUBLIC_APP_URL: "https://royal.example",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY,
  });

  assert.equal(overridden?.issuer, "https://auth.royal.example");
  assert.equal(overridden?.resource, "https://mcp.royal.example/eve/v1/mcp");
});

test("an unusable app URL falls back rather than publishing rubbish", () => {
  // new URL() throws on these; a resource of "undefined/eve/v1/mcp" would be
  // worse than letting Eve read the request.
  for (const appUrl of [undefined, "", "   ", "royal.example", "not a url"]) {
    const config = mcpResourceConfig({
      NEXT_PUBLIC_APP_URL: appUrl,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY,
    });
    assert.equal(config?.resource, undefined, `accepted ${String(appUrl)}`);
  }
});

test("no Clerk instance means no advertised authorization server", () => {
  assert.equal(mcpResourceConfig({}), null);
});

test("the advertised scopes are ones Clerk actually issues", () => {
  // Clerk's authorization server supports openid, profile, email,
  // public_metadata, private_metadata and offline_access. Advertising a scope
  // outside that list makes the authorize step fail at Clerk, before the
  // client ever reaches this endpoint.
  const CLERK_SUPPORTED = new Set([
    "openid",
    "profile",
    "email",
    "public_metadata",
    "private_metadata",
    "offline_access",
  ]);
  for (const scope of MCP_SCOPES) {
    assert.ok(CLERK_SUPPORTED.has(scope), `Clerk does not issue ${scope}`);
  }
});
