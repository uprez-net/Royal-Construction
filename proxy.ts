import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { isDevAutoSignInEnabled } from "@/lib/auth/dev-auth"
import { getUserByClerkId } from "./lib/data/user";

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
  // DocuSign Connect webhook — authenticated via HMAC signature, not Clerk.
  "/api/docusign(.*)",
  '/.well-known(.*)',
  '/api/mcp(.*)',
  '/api/sse(.*)',
  '/api/message(.*)',
  "/api/cron(.*)",
  "/book-consultation",
  "/api/upload(.*)",
  "/api/resume-stream(.*)",
])
const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"])
const isDevAuthRoute = createRouteMatcher(["/dev/sign-in(.*)", "/api/dev/(.*)"])
const isAdminRoute = createRouteMatcher(["/admin(.*)"])

export default clerkMiddleware(async (auth, request) => {
  // Dev auth routes always pass through — they create the session
  if (isDevAuthRoute(request)) return

  const pathname = request.nextUrl.pathname
  const isApiRoute = pathname.startsWith("/api/") || pathname.startsWith("/trpc/")

  // Dev: auto-redirect unauthenticated page navigations to the token sign-in flow
  if (isDevAutoSignInEnabled() && !isPublicRoute(request) && !isAuthRoute(request) && !isApiRoute) {
    const { userId } = await auth()
    if (!userId) {
      const signInUrl = new URL("/api/dev/sign-in", request.url)
      signInUrl.searchParams.set("redirect_url", `${pathname}${request.nextUrl.search}`)
      return NextResponse.redirect(signInUrl)
    }
  }

  const { userId, sessionClaims } = await auth()

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
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
    } else {
      await auth.protect()
    }
  }

  if (isAdminRoute(request) && (await getUserByClerkId(userId ?? ""))?.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (sessionClaims?.public_metadata.role === "GUEST") {
    // Same reasoning: a redirect to an HTML page is not a usable answer to a
    // fetch(), which follows it and then fails to parse the body as JSON.
    if (isApiRoute) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return NextResponse.redirect(new URL("/guest", request.url))
  }
  if (isAuthRoute(request) && userId) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
