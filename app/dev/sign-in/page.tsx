"use client"

import { useSignIn } from "@clerk/nextjs"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"
import { Suspense } from "react"

function DevSignInInner() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const router = useRouter()
  const params = useSearchParams()
  const attempted = useRef(false)

  useEffect(() => {
    if (!isLoaded || attempted.current) return
    attempted.current = true

    const token = params.get("token")
    const redirectUrl = params.get("redirect_url") ?? "/dashboard"

    if (!token) {
      router.replace("/sign-in")
      return
    }

    signIn
      .create({ strategy: "ticket", ticket: token })
      .then(async (attempt) => {
        if (attempt.status !== "complete") throw new Error(attempt.status)
        await setActive({ session: attempt.createdSessionId })
        router.replace(redirectUrl)
      })
      .catch(() => router.replace("/sign-in"))
  }, [isLoaded, signIn, setActive, router, params])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[oklch(0.979_0.006_248.4)]">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-[oklch(0.584_0.118_183.6)]" />
    </div>
  )
}

export default function DevSignInPage() {
  return (
    <Suspense>
      <DevSignInInner />
    </Suspense>
  )
}
