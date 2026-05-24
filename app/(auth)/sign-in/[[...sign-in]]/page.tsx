import { Suspense } from "react"
import { SignIn } from "@clerk/nextjs"

function SignInFallback() {
  return (
    <div className="flex min-h-[31.25rem] items-center justify-center">
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
