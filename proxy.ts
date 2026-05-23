import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

const isPublicRoute = createRouteMatcher(["/api/webhook/clerk(.*)", "/api/graph(.*)"])
const isAuthRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)'])

export default clerkMiddleware(async (auth, request) => {
  // Dev bypass: NEXT_PUBLIC_BYPASS_AUTH=true in .env.local skips auth for local testing
  if (process.env.NEXT_PUBLIC_BYPASS_AUTH === "true") {
    return NextResponse.next()
  }

  if (!isPublicRoute(request) && !isAuthRoute(request)) await auth.protect()
  const { userId } = await auth()
  if (isAuthRoute(request) && userId) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/dashboard',
      },
    })
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
