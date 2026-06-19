import { Suspense } from "react"
import { SignIn } from "@clerk/nextjs"
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Access your construction management dashboard by signing in to your account.",
};

function SignInFallback() {
  return (
    <div className="flex min-h-125 items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </Suspense>
  )
}
