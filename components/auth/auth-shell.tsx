import type { ReactNode } from "react"
import Link from "next/link"
import { Hammer } from "lucide-react"

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(232,115,12,0.12),_transparent_26%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.96))]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px)] bg-[size:40px_40px] opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="flex flex-col justify-between rounded-[2rem] border border-white/70 bg-slate-950 p-8 text-white shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
            <div className="space-y-6">
              <Link href="/" className="inline-flex items-center gap-3 text-teal-300">
                <span className="grid size-11 place-items-center rounded-2xl bg-teal-500/15">
                  <Hammer className="size-5" />
                </span>
                <span className="font-heading text-2xl font-semibold">BuildPro</span>
              </Link>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-300/80">Authentication</p>
                <h1 className="max-w-md font-heading text-4xl font-semibold tracking-tight">{title}</h1>
                <p className="max-w-lg text-sm leading-6 text-slate-300">{description}</p>
              </div>
            </div>
            <div className="mt-10 grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300 sm:grid-cols-3">
              <div>
                <p className="text-slate-100">Clerk-native</p>
                <p className="mt-1 text-xs">Sign-in, sign-up, profile, and session flows.</p>
              </div>
              <div>
                <p className="text-slate-100">Protected</p>
                <p className="mt-1 text-xs">Proxy-based route guarding for the entire portal.</p>
              </div>
              <div>
                <p className="text-slate-100">Composable</p>
                <p className="mt-1 text-xs">Wrap Clerk UI without rebuilding auth from scratch.</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center rounded-[2rem] border border-white/70 bg-white/90 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="w-full max-w-lg">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
