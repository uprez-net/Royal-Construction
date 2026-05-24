import { notFound } from "next/navigation"
import { isDevAutoSignInEnabled } from "@/lib/auth/dev-auth"

export default function DevSignInLayout({ children }: { children: React.ReactNode }) {
  if (!isDevAutoSignInEnabled()) notFound()
  return <>{children}</>
}
