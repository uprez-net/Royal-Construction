import { Suspense } from "react"
import { SignUp } from "@clerk/nextjs"

function SignUpFallback() {
  return (
    <div className="flex min-h-[31.25rem] items-center justify-center">
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
