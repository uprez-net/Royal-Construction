import { Suspense } from "react"
import { SignUp } from "@clerk/nextjs"
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Restricted Access - Sign Up",
  description: "New Account Registration is disabled. Please contact your administrator to request access.",
};

function SignUpFallback() {
  return (
    <div className="flex min-h-125 items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<SignUpFallback />}>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </Suspense>
  )
}
