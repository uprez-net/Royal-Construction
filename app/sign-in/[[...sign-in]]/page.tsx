import { SignIn } from "@clerk/nextjs"

import { AuthShell } from "@/components/auth/auth-shell"

export default function SignInPage() {
  return (
    <AuthShell
      title="Sign in to BuildPro"
      description="Use the Clerk-managed sign-in flow so authentication remains secure, consistent, and easy to extend."
    >
      <div className="overflow-hidden rounded-[1.5rem] border border-border bg-background shadow-sm">
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
      </div>
    </AuthShell>
  )
}
