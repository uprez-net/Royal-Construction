import { UserProfile } from "@clerk/nextjs"

import { AuthShell } from "@/components/auth/auth-shell"

export default function UserProfilePage() {
  return (
    <AuthShell
      title="User profile"
      description="Manage your account, security settings, and session details with the Clerk profile component."
    >
      <div className="overflow-hidden rounded-[1.5rem] border border-border bg-background shadow-sm">
        <UserProfile routing="path" path="/user-profile" />
      </div>
    </AuthShell>
  )
}
