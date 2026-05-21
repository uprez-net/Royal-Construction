
import { AuthShell } from "@/components/auth/auth-shell"

export default function AuthLayout({
  children,
}: {
    children: React.ReactNode
}) {
    return (
        <AuthShell
            title="Welcome to Royal Constructions"
            description="Please sign in or sign up to continue."
        >
            {children}
        </AuthShell>
    )
}