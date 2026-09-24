import { randomBytes } from "node:crypto";

import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { getUserByClerkId } from "@/lib/data/user";
import prisma from "@/lib/prisma";
import { buildXeroClient, expiryFromTokenSet } from "@/lib/xero/client";
import { getXeroConfig, XERO_SCOPES } from "@/lib/xero/config";
import { disconnectXero } from "@/lib/domain/integrations/xero";
import { userPrincipal } from "@/lib/domain/principal";
import {
  errorResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from "@/utils/validators";

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
 * Admin-only, and authenticated as a PERSON rather than by a shared secret —
 * this grants an application-wide accounting connection. The check lives in
 * `requireAdmin` below rather than in the middleware, because a browser
 * navigation needs a redirect where the middleware's /api/ branch would send a
 * JSON error body.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Both legs of this route are browser navigations, so a refusal has to be
  // somewhere to go rather than a status code with a JSON body. The middleware
  // treats every /api/ path as a fetch client and would answer a lapsed session
  // with `{"error":"Unauthorized"}` on screen; that is why this route is exempt
  // there and does the checking here.
  const guard = await requireAdmin();
  if (!guard.ok) {
    return refuseNavigation(request, guard.reason);
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
    return clearState(
      redirectToAdmin(request, { error: consentErrorCode(error) }),
    );
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
  // Unlike GET, this one IS a fetch — the admin panel calls it — so the shared
  // JSON error envelope is the right answer.
  const guard = await requireAdmin();
  if (!guard.ok) {
    return refuseFetch(guard.reason);
  }

  const user = await getUserByClerkId(guard.userId);
  if (!user) return refuseFetch("lookup_failed");
  try {
    const disconnected = await disconnectXero(
      userPrincipal(user),
      prisma,
      async ({ accessToken, refreshToken }) => {
        const xero = buildXeroClient(getXeroConfig());
        await xero.initialize();
        xero.setTokenSet({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: "Bearer",
        });
        await xero.revokeToken();
      },
    );
    return NextResponse.json({ success: true, data: disconnected });
  } catch (error) {
    console.error("[xero] Disconnect failed:", error);
    return errorResponse("Could not disconnect Xero", {
      status: 502,
      code: "XERO_DISCONNECT_FAILED",
    });
  }
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

type AdminRefusal = "unauthenticated" | "forbidden" | "lookup_failed";

type AdminGuard =
  | { ok: true; userId: string }
  | { ok: false; reason: AdminRefusal };

/**
 * The signed-in ADMIN, or why not.
 *
 * Returns the reason rather than a response because the two methods on this
 * route have different audiences — a browser for GET, a fetch for DELETE — and
 * only the caller knows which shape a refusal should take.
 *
 * This route is exempt from the middleware's auth enforcement, so this check is
 * the only one standing. `auth()` still resolves: clerkMiddleware runs for
 * public routes too and populates the session either way.
 */
async function requireAdmin(): Promise<AdminGuard> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return { ok: false, reason: "unauthenticated" };
  }

  try {
    const user = await getUserByClerkId(clerkId);
    if (user?.role !== "ADMIN") {
      return { ok: false, reason: "forbidden" };
    }
    return { ok: true, userId: user.id };
  } catch (lookupError) {
    console.error("[xero] Admin lookup failed:", lookupError);
    return { ok: false, reason: "lookup_failed" };
  }
}

/** Refuse a browser navigation with somewhere to go. */
function refuseNavigation(
  request: NextRequest,
  reason: AdminRefusal,
): NextResponse {
  if (reason === "unauthenticated") {
    // Deliberately back to the admin page, NOT to this URL. An authorization
    // code is single-use and short-lived, so replaying it after a sign-in
    // detour fails in a way nobody could diagnose. Landing on the page they
    // started from lets them press Connect again against a fresh session.
    const signIn = new URL(
      process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in",
      request.nextUrl.origin,
    );
    signIn.searchParams.set("redirect_url", ADMIN_XERO_PATH);

    return NextResponse.redirect(signIn);
  }

  // A signed-in non-admin, or a role lookup that failed and left us unable to
  // tell: both get the dashboard, which is what the middleware does to anyone
  // who wanders onto an /admin page. Failing closed on the lookup error also
  // avoids bouncing them to /admin/xero, where the same lookup would fail again
  // and send them here anyway.
  return NextResponse.redirect(new URL("/dashboard", request.nextUrl.origin));
}

/** Refuse a fetch with the shared error envelope. */
function refuseFetch(reason: AdminRefusal): NextResponse {
  switch (reason) {
    case "unauthenticated":
      return unauthorizedResponse();
    case "forbidden":
      return forbiddenResponse("Only admins can manage the Xero connection.");
    default:
      return errorResponse("Could not verify your account", { status: 500 });
  }
}

/**
 * Xero's consent-redirect error, narrowed to a code the admin page knows.
 * Anything unfamiliar collapses to `refused` rather than being passed along.
 */
function consentErrorCode(error: string): string {
  return error === "access_denied" || error === "invalid_scope"
    ? error
    : "refused";
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
