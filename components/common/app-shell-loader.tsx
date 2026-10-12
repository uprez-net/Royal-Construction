"use client";

import Image from "next/image";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The layout's Suspense fallback while the signed-in user resolves. It draws
// the same frame as AppShell (light ground, white sidebar and header) so a hard
// refresh does not flash a dark teal app before the gold one. Only the
// placeholders pulse, and Skeleton stops pulsing under reduced motion.
export function AppShellLoader({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-[calc(100dvh-var(--sandbox-banner-height,0px))] overflow-hidden bg-[#F7F6F2] text-foreground">
      <div className="flex h-full">
        {/* Sidebar */}
        <aside className="hidden w-16 shrink-0 border-r border-border bg-white shadow-sm md:flex md:flex-col md:items-center md:py-4">
          <div className="mb-5 grid size-10 place-items-center rounded-2xl bg-[#F7F6F2]">
            <Image
              src="/favicon.ico"
              alt="Royal Constructions Logo"
              width={32}
              height={32}
            />
          </div>

          <div className="flex flex-1 flex-col items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="size-10 rounded-lg" />
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="z-30 shrink-0 border-b border-border bg-white shadow-sm">
            <div className="flex w-full items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6 sm:py-3 lg:px-8">
              <div className="flex min-w-0 items-center gap-2 sm:gap-4">
                <Skeleton className="size-10 rounded-lg md:hidden" />
                <div className="min-w-0">
                  <div className="flex h-7 items-center">
                    <Skeleton className="h-5 w-44 bg-royal-gold/20" />
                  </div>

                  <div className="flex h-4 items-center gap-2">
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden flex-col items-end md:flex">
                  <div className="flex h-4 items-center">
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex h-4 items-center">
                    <Skeleton className="h-3 w-8" />
                  </div>
                </div>

                <Skeleton className="size-10 rounded-lg" />

                <Skeleton className="hidden size-9 rounded-full md:block" />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main
            className={cn(
              "flex min-h-0 min-w-0 w-full flex-1 flex-col gap-4 sm:gap-6",
              "overflow-y-auto",
              "px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-6",
              "scrollbar-none",
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
