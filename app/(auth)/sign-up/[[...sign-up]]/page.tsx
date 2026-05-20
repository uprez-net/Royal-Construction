import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export function SignUpFallback() {
  return (
    <div className="flex min-h-125 items-center justify-center">
      Loading...
    </div>
  )
}

export default function SignUpPage() {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-border bg-background shadow-sm">
      <Suspense fallback={<SignUpFallback />}>
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
      </Suspense>
    </div>
  );
}
