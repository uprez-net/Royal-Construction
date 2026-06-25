import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { isDevAutoSignInEnabled } from "@/lib/auth/dev-auth"

const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "196994eb-5059-4fe8-ac4e-7c6d9934bbcf";

const isPublicRoute = createRouteMatcher([
  "/api/webhook/clerk(.*)",
  "/api/graph(.*)",
  '/.well-known(.*)',
  '/mcp(.*)',
  '/sse(.*)',
  'message(.*)',
  "/api/cron(.*)",
  "/book-consultation",
  "/api/upload(.*)",
  "/api/resume-stream(.*)",
])
const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"])
const isDevAuthRoute = createRouteMatcher(["/dev/sign-in(.*)", "/api/dev/(.*)"])
const isAdminRoute = createRouteMatcher(["/admin-approvals(.*)"])

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

  if (!isPublicRoute(request) && !isAuthRoute(request)) await auth.protect()

  const { userId, sessionClaims } = await auth()
  if (isAdminRoute(request) && userId !== ADMIN_USER_ID) {
    return new Response(null, {
      status: 302,
      headers: { location: "/dashboard" },
    })
  }
  if(sessionClaims?.public_metadata.role === "GUEST") {
    return new Response(null, {
      status: 302,
      headers: { location: "/guest" },
    })
  }
  if (isAuthRoute(request) && userId) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    })
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
