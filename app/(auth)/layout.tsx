
import { AuthShell } from "@/components/auth/auth-shell"

export default function AuthLayout({
  children,
}: {
    children: React.ReactNode
}) {
    return (
        <AuthShell
            title="Every build, one place."
            description="Manage your projects, tradies, and financials from your construction workspace."
        >
            {children}
        </AuthShell>
    )
}