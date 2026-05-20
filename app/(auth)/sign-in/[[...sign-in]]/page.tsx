import { Suspense } from "react"
import { SignIn } from "@clerk/nextjs"

function SignInFallback() {
  return (
    <div className="flex min-h-125 items-center justify-center">
      Loading...
    </div>
  )
}

export default function SignInPage() {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-border bg-background shadow-sm">
      <Suspense fallback={<SignInFallback />}>
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
        />
      </Suspense>
    </div>
  )
}