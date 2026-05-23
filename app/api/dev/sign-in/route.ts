import { clerkClient } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"
import { DEV_AUTH, isDevAutoSignInEnabled } from "@/lib/auth/dev-auth"

export async function GET(req: NextRequest) {
  if (!isDevAutoSignInEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const redirectUrl = req.nextUrl.searchParams.get("redirect_url") ?? "/dashboard"

  const client = await clerkClient()
  const { token } = await client.signInTokens.createSignInToken({
    userId: DEV_AUTH.clerkUserId,
    expiresInSeconds: 60 * 60,
  })

  const url = new URL("/dev/sign-in", req.url)
  url.searchParams.set("token", token)
  url.searchParams.set("redirect_url", redirectUrl)

  return NextResponse.redirect(url)
}
