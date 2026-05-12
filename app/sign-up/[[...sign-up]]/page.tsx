import { SignUp } from "@clerk/nextjs"

import { AuthShell } from "@/components/auth/auth-shell"

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your BuildPro account"
      description="Sign up with Clerk so the portal can handle session state, org flows, and profile management without custom auth forms."
    >
      <div className="overflow-hidden rounded-[1.5rem] border border-border bg-background shadow-sm">
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
      </div>
    </AuthShell>
  )
}
