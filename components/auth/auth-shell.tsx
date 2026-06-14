import type { ReactNode } from "react"
import Image from "next/image"

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
    <div className="flex min-h-screen">
      <aside className="relative hidden w-[42%] flex-shrink-0 flex-col overflow-hidden bg-[oklch(0.16_0.03_249.8)] px-12 py-10 text-white lg:flex">
        {/* Background photo */}
        <Image
          src="https://images.unsplash.com/photo-1587582423116-ec07293f0395?auto=format&fit=crop&w=900&q=80"
          alt=""
          fill
          sizes="42vw"
          className="object-cover"
          priority
        />

        {/* Gradient scrim — dark at bottom (text), fades toward top (photo) */}
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(22,23,38,0.93)_0%,rgba(22,23,38,0.70)_40%,rgba(22,23,38,0.50)_70%,rgba(22,23,38,0.28)_100%)]" />

        <div className="relative flex flex-1 flex-col justify-between">
          <div>
            <h1 className="font-heading text-5xl font-semibold leading-[1.1] tracking-tight">
              {title}
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-slate-300">{description}</p>
          </div>

          <div className="space-y-5 border-t border-white/15 pt-6">
            <div className="flex items-center gap-3">
              <Image
                src="/image-78.png"
                alt=""
                width={64}
                height={38}
                className="object-contain invert opacity-50"
              />
              <span className="text-xs text-slate-400">Master Builders Association NSW</span>
            </div>
            <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold text-slate-100">Full visibility</dt>
                <dd className="mt-1.5 text-xs leading-5 text-slate-400">Every job, milestone, and tradie in one place.</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-100">Quote to close</dt>
                <dd className="mt-1.5 text-xs leading-5 text-slate-400">Capture leads, build quotes, convert without paperwork.</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-100">Built for builders</dt>
                <dd className="mt-1.5 text-xs leading-5 text-slate-400">Workflows that match how construction actually runs.</dd>
              </div>
            </dl>
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center bg-[oklch(0.979_0.006_248.4)] px-8 py-12">
        <div className="mb-8">
          <Image
            src="/logo-1024x713.png"
            alt="Royal Constructions"
            width={160}
            height={111}
            className="object-contain"
            priority
          />
        </div>
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}
