import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isDevAutoSignInEnabled } from "@/lib/auth/dev-auth";
import prisma from "./lib/prisma";
import { findUserByClerkId } from "./lib/domain/identity/users";

const isPublicRoute = createRouteMatcher([
  "/api/webhook/clerk(.*)",
  // Only the Graph routes that genuinely have no session are public. The
  // blanket "/api/graph(.*)" that used to sit here also exposed the admin
  // endpoints (subscribe, send, token, list), which are now behind Clerk as
  // well as their admin-token guard.
  //   notifications          — Microsoft Graph calls it; validates clientState.
  //   book-consultant        — posted from the public /book-consultation page.
  //   read-calender-dateTime — read by that same public page.
  "/api/graph/notifications(.*)",
  "/api/graph/book-consultant(.*)",
  "/api/graph/read-calender-dateTime(.*)",
  "/api/graph/subscribe(.*)",
  // DocuSign Connect webhook — authenticated via HMAC signature, not Clerk.
  "/api/docusign(.*)",
  // Xero webhook — Xero calls it; authenticated by the x-xero-signature HMAC.
  "/api/xero/notification(.*)",
  // WhatsApp Cloud API webhook — Meta calls it. The GET handshake checks
  // WHATSAPP_WEBHOOK_VERIFY_TOKEN; every POST is authenticated by the
  // X-Hub-Signature-256 HMAC over the raw body (lib/whatsapp/webhook-handler.ts).
  "/api/whatsapp/webhook(.*)",
  // SMS and call callbacks — Twilio or Telnyx calls them. Every request is
  // authenticated by the carrier's signature (X-Twilio-Signature HMAC, Telnyx
  // Ed25519) over the exact URL and raw body (lib/comms/webhook-handler.ts).
  // Only the two carriers; /api/comms/voice/* (browser credentials) is not
  // public.
  "/api/comms/twilio/(.*)",
  "/api/comms/telnyx/(.*)",
  // Mili's audio: the carrier opens a WebSocket here for an answered inbound
  // call. It has no session; the stream is accepted only with a token the app
  // signed for that call under COMMS_AGENT_SECRET (lib/comms/voice-agent).
  "/api/comms/voice-agent/(.*)",
  // Xero OAuth consent + callback. "Public" here only means the blanket
  // /api/ JSON-401 below does not apply: both legs are BROWSER navigations
  // (the admin clicks Connect; Xero redirects back with ?code), and answering
  // one with a JSON error body strands the operator on a blob of JSON with a
  // spent authorization code. The handler runs its own Clerk + ADMIN check and
  // answers with redirects, and `auth()` still resolves inside it because
  // clerkMiddleware runs for public routes too — it just stops enforcing.
  "/api/xero/connect(.*)",
  // Covers the Workflow package's routes under /.well-known/workflow, and the
  // RFC 9728 path that redirects to Eve's MCP protected-resource metadata --
  // an unauthenticated client has to be able to read that to sign in at all.
  "/.well-known(.*)",
  "/api/cron(.*)",
  // The Eve runtime reports what an agent write touched; no Clerk session
  // exists on that call. The route checks its own shared bearer.
  "/api/agent/effects",
  "/book-consultation",
  "/api/upload(.*)",
  "/api/resume-stream(.*)",
  // Eve owns authentication for its browser-facing HTTP channel. Keeping the
  // route out of Clerk's page/API protection is important: auth.protect() can
  // turn an unauthenticated fetch into a redirect (and, after the redirect,
  // an HTML 404), while Eve must return its own structured 401/403 response.
  "/eve/v1(.*)",
]);
const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
// The client's booking page and the two APIs it calls. A signed-in GUEST
// (Clerk's default for a new account, a client among them) may use these and
// nothing else: other public routes, Eve's channel among them, rely on the
// GUEST block below.
const isPublicBookingRoute = createRouteMatcher([
  "/book-consultation",
  "/api/graph/book-consultant(.*)",
  "/api/graph/read-calender-dateTime(.*)",
]);
const isEvalAuthRoute = createRouteMatcher(["/api/eval/auth(.*)"]);
const isDevAuthRoute = createRouteMatcher([
  "/dev/sign-in(.*)",
  "/api/dev/(.*)",
]);
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);
// The sales side's screens. A site manager is sent to their dashboard instead.
// Pages only: the data behind them refuses a site manager in the domain
// (`isOfficePrincipal`), which is what actually holds if this is bypassed or
// the session token still carries yesterday's role.
const isOfficeOnlyPage = createRouteMatcher([
  "/leads(.*)",
  "/offers(.*)",
  "/agent(.*)",
]);

// Next 16 renamed the `middleware` convention to `proxy` and deprecated the
// `middleware` export name. A `proxy.ts` file is resolved as `mod.proxy ||
// mod.default`, so exporting the handler as `proxy` is the non-deprecated
// form — keep it the only handler export, multiple are not supported.
export const proxy = clerkMiddleware(async (auth, request) => {
  // The staging evaluator authenticates with its own header and secret. It
  // must reach the route before Clerk's browser/session protection, which
  // would turn its structured 401/404 response into an auth redirect.
  if (isEvalAuthRoute(request)) return;

  // Dev auth routes always pass through — they create the session
  if (isDevAuthRoute(request)) return;

  const pathname = request.nextUrl.pathname;
  const isApiRoute =
    pathname.startsWith("/api/") || pathname.startsWith("/trpc/");

  // Dev: auto-redirect unauthenticated page navigations to the token sign-in flow
  if (
    isDevAutoSignInEnabled()
    && !isPublicRoute(request)
    && !isAuthRoute(request)
    && !isApiRoute
  ) {
    const { userId } = await auth();
    if (!userId) {
      const signInUrl = new URL("/api/dev/sign-in", request.url);
      signInUrl.searchParams.set(
        "redirect_url",
        `${pathname}${request.nextUrl.search}`,
      );
      return NextResponse.redirect(signInUrl);
    }
  }

  const { userId, sessionClaims } = await auth();

  if (!isPublicRoute(request) && !isAuthRoute(request)) {
    // auth.protect() only redirects requests it recognises as page navigations.
    // A plain fetch() sends `sec-fetch-dest: empty` and no `next-url`, so it is
    // neither a page request nor a server action, and Clerk falls through to
    // notFound() — the request comes back 404 with an HTML body. That is why an
    // expired session on /leads shows up as a pile of 404s on /api/leads rather
    // than as one honest 401. Answer API routes ourselves so the status code
    // describes what actually happened.
    if (isApiRoute) {
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      await auth.protect();
    }
  }

  if (
    isAdminRoute(request)
    && (await findUserByClerkId(userId ?? "", prisma))?.role !== "ADMIN"
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (
    sessionClaims?.public_metadata.role === "GUEST"
    && !isPublicBookingRoute(request)
  ) {
    // Same reasoning: a redirect to an HTML page is not a usable answer to a
    // fetch(), which follows it and then fails to parse the body as JSON.
    if (isApiRoute) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/guest", request.url));
  }
  if (
    sessionClaims?.public_metadata.role === "SITE_MANAGER"
    && isOfficeOnlyPage(request)
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (isAuthRoute(request) && userId) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
