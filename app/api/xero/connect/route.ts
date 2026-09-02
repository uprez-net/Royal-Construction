import { randomBytes } from "node:crypto";

import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { getUserByClerkId } from "@/lib/data/user";
import prisma from "@/lib/prisma";
import { buildXeroClient, expiryFromTokenSet } from "@/lib/xero/client";
import { getXeroConfig, XERO_SCOPES } from "@/lib/xero/config";
import { errorResponse, forbiddenResponse, unauthorizedResponse } from "@/utils/validators";

// The OAuth consent round-trip goes out to Xero and back; the callback leg also
// exchanges a code, lists tenants and reads the organisation.
export const maxDuration = 60;

const STATE_COOKIE = "xero_oauth_state";
const STATE_TTL_SECONDS = 600;
const ADMIN_XERO_PATH = "/admin/xero";

/**
 * Xero OAuth2 authorization-code flow, both legs on one route.
 *
 * One route rather than two because Xero registers a single redirect URI per
 * app and it must match byte for byte — splitting start and callback would mean
 * registering both and keeping them in step. The presence of `?code` says which
 * leg this is.
 *
 * Admin-only, and it stays behind Clerk (unlike the notification route): this
 * one grants an application-wide accounting connection, so it is authenticated
 * as a person, not by a shared secret.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("response" in guard) {
    return guard.response;
  }

  const url = request.nextUrl;
  const error = url.searchParams.get("error");
  if (error) {
    // The operator declined consent, or Xero refused. Not our failure to log
    // loudly — send them back with something readable.
    //
    // A CODE, never Xero's own text. Everything on this query string is
    // attacker-controllable through a crafted link and ends up in an alert on
    // an admin page; the page owns the wording and ignores codes it does not
    // recognise, so a stranger cannot put words in our UI.
    return clearState(redirectToAdmin(request, { error: consentErrorCode(error) }));
  }

  return url.searchParams.get("code")
    ? completeConnection(request, guard.userId)
    : startConnection();
}

/**
 * Disconnect the organisation.
 *
 * The row is marked inactive rather than deleted so there is still a record of
 * who connected what and when after someone pulls the plug.
 */
export async function DELETE(): Promise<NextResponse> {
  const guard = await requireAdmin();
  if ("response" in guard) {
    return guard.response;
  }

  const connection = await prisma.xeroConnection.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) {
    return NextResponse.json({ success: true, data: { disconnected: false } });
  }

  try {
    const xero = buildXeroClient(getXeroConfig());
    // `revokeToken()` calls straight through to `openIdClient.revoke()` with no
    // lazy-init guard of its own — unlike `buildConsentUrl` and `apiCallback`,
    // which initialize on demand. Without this it throws on undefined and the
    // token is never actually revoked at Xero.
    await xero.initialize();
    xero.setTokenSet({
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken,
      token_type: "Bearer",
    });
    await xero.revokeToken();
  } catch (revokeError) {
    // Xero may already consider the token dead, which is the state we are
    // heading for anyway. Deactivate locally regardless — leaving the row
    // active would keep the invoice generator trying to use a token we have
    // just told the operator is gone.
    console.error("[xero] Token revocation failed; deactivating locally:", revokeError);
  }

  await prisma.xeroConnection.update({
    where: { id: connection.id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true, data: { disconnected: true } });
}

/** Send the operator to Xero's consent screen. */
async function startConnection(): Promise<NextResponse> {
  const config = getXeroConfig();

  // CSRF: a random state, held in an httpOnly cookie and checked on the way
  // back. The SDK compares the returned state against the one the client was
  // constructed with, which is why the callback leg rebuilds the client from
  // the cookie rather than sharing an instance.
  const state = randomBytes(16).toString("hex");
  const xero = buildXeroClient(config, { state });
  const consentUrl = await xero.buildConsentUrl();

  const response = NextResponse.redirect(consentUrl);
  // Set on the response itself rather than through `cookies()`. Both are
  // supported in a route handler, but this one cannot be anything other than
  // the Set-Cookie on the very redirect that starts the flow — and if the
  // cookie does not survive that hop, the callback has no state to check
  // against and the connection cannot complete.
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, not Strict: the browser arrives back from Xero on a cross-site
    // top-level navigation, which Strict would withhold the cookie from.
    sameSite: "lax",
    path: "/api/xero",
    maxAge: STATE_TTL_SECONDS,
  });

  return response;
}

/** Exchange the code, discover the tenant, and store the token set. */
async function completeConnection(
  request: NextRequest,
  userId: string,
): Promise<NextResponse> {
  const state = request.cookies.get(STATE_COOKIE)?.value;
  if (!state) {
    return redirectToAdmin(request, {
      error: "expired",
    });
  }

  const config = getXeroConfig();
  const xero = buildXeroClient(config, { state });

  try {
    const tokenSet = await xero.apiCallback(request.url);
    if (!tokenSet.access_token || !tokenSet.refresh_token) {
      // No refresh token means `offline_access` was not granted, and the
      // connection would die in 30 minutes with no way to renew it.
      return clearState(
        redirectToAdmin(request, {
          error: "no_refresh_token",
        }),
      );
    }

    // Which organisation was actually consented to — the reason this flow beats
    // pasting a tenant id into an env var.
    const tenants = await xero.updateTenants(false);
    const tenant = tenants[0];
    if (!tenant?.tenantId) {
      return clearState(
        redirectToAdmin(request, {
          error: "no_tenant",
        }),
      );
    }

    const data = {
      tenantName: tenant.tenantName ?? null,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      expiresAt: expiryFromTokenSet(tokenSet.expires_at, tokenSet.expires_in),
      refreshedAt: new Date(),
      // What Xero actually granted, which can be narrower than what was asked
      // for. Recording the request would make this field a restatement of a
      // constant rather than a record of the connection.
      scopes: grantedScopes(tokenSet.scope),
      connectedById: userId,
      isActive: true,
    };

    // Re-consenting the same organisation updates the existing row; connecting
    // a different one supersedes the old, since the invoice generator reads a
    // single active connection.
    await prisma.$transaction([
      prisma.xeroConnection.updateMany({
        where: { isActive: true, tenantId: { not: tenant.tenantId } },
        data: { isActive: false },
      }),
      prisma.xeroConnection.upsert({
        where: { tenantId: tenant.tenantId },
        create: { tenantId: tenant.tenantId, ...data },
        update: data,
      }),
    ]);
  } catch (callbackError) {
    console.error("[xero] OAuth callback failed:", callbackError);
    return clearState(
      redirectToAdmin(request, {
        error: "failed",
      }),
    );
  }

  return clearState(redirectToAdmin(request, { connected: "1" }));
}

/**
 * The granted scopes, as a list.
 *
 * RFC 6749 puts `scope` on the token response as a space-delimited string, and
 * that is what Xero sends, but `TokenSet` passes the field through untouched —
 * so handle both shapes rather than trusting one.
 */
function grantedScopes(scope: unknown): string[] {
  if (Array.isArray(scope)) {
    return scope.map(String);
  }
  if (typeof scope === "string") {
    return scope.split(" ").filter(Boolean);
  }

  return [...XERO_SCOPES];
}

/**
 * The signed-in ADMIN, or the response to send instead.
 *
 * Clerk's middleware already answers unauthenticated API requests with a 401,
 * so this is the role check plus a belt-and-braces re-read of the session — the
 * same shape the mutating routes under `app/api/(data)` use.
 */
async function requireAdmin(): Promise<
  { userId: string } | { response: NextResponse }
> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return { response: unauthorizedResponse() };
  }

  try {
    const user = await getUserByClerkId(clerkId);
    if (user?.role !== "ADMIN") {
      return { response: forbiddenResponse("Only admins can manage the Xero connection.") };
    }
    return { userId: user.id };
  } catch (lookupError) {
    console.error("[xero] Admin lookup failed:", lookupError);
    return { response: errorResponse("Could not verify your account", { status: 500 }) };
  }
}

/**
 * Xero's consent-redirect error, narrowed to a code the admin page knows.
 * Anything unfamiliar collapses to `refused` rather than being passed along.
 */
function consentErrorCode(error: string): string {
  return error === "access_denied" || error === "invalid_scope" ? error : "refused";
}

/** Retire the one-shot state cookie, whichever way the callback ended. */
function clearState(response: NextResponse): NextResponse {
  response.cookies.set(STATE_COOKIE, "", { path: "/api/xero", maxAge: 0 });

  return response;
}

/** Back to the admin page, carrying the outcome for it to render. */
function redirectToAdmin(
  request: NextRequest,
  params: Record<string, string>,
): NextResponse {
  const destination = new URL(ADMIN_XERO_PATH, request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    destination.searchParams.set(key, value);
  }

  return NextResponse.redirect(destination);
}
