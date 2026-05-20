"use client";

import { Hammer, Bell } from "lucide-react";

import { cn } from "@/lib/utils";

export function AppShellLoader({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent text-foreground animate-pulse">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(circle at top left, rgba(13,148,136,0.18), transparent 34%), radial-gradient(circle at top right, rgba(232,115,12,0.12), transparent 26%), linear-gradient(180deg, rgba(248,250,252,0.94), rgba(241,245,249,0.94))",
        }}
      />

      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(rgba(15,23,42,0.06) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "linear-gradient(to bottom, black, transparent)",
        }}
      />

      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden w-16 shrink-0 border-r border-white/10 bg-slate-950 text-slate-300 shadow-[6px_0_28px_rgba(15,23,42,0.12)] md:flex md:flex-col md:items-center md:py-4">
          <div className="mb-5 grid size-10 place-items-center rounded-2xl bg-teal-500/15 text-teal-400">
            <Hammer className="size-5" />
          </div>

          <div className="flex flex-1 flex-col items-center gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="size-10 rounded-2xl bg-white/10" />
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="sticky top-0 z-30 border-b border-white/60 bg-slate-950 text-white shadow-[0_10px_30px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-4">
                <div>
                  <div className="h-6 w-32 rounded-md bg-teal-500/20" />

                  <div className="mt-2 hidden items-center gap-2 md:flex">
                    <div className="h-3 w-14 rounded bg-white/10" />
                    <div className="h-3 w-3 rounded bg-white/10" />
                    <div className="h-3 w-24 rounded bg-white/10" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden text-right md:block">
                  <div className="h-4 w-20 rounded bg-white/10" />
                  <div className="mt-1 h-3 w-10 rounded bg-white/10" />
                </div>

                <div className="grid size-10 place-items-center rounded-2xl border border-white/10 bg-white/5">
                  <Bell className="size-4 text-slate-500" />
                </div>

                <div className="size-9 rounded-full bg-white/10" />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main
            className={cn(
              "mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6",
              "overflow-y-auto",
              "max-h-[90vh]",
              "px-4 py-5 sm:px-6 lg:px-8 lg:py-6",
              "[scrollbar-width:none]",
              "[-ms-overflow-style:none]",
              "[&::-webkit-scrollbar]:hidden",
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
