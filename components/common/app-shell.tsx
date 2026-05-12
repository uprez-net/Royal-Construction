"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, Search, Hammer, ChevronRight } from "lucide-react";
import { SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

import { navigationItems, tickerItems } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AppShell({
  isSignedIn,
  activeSlug,
  title,
  description,
  breadcrumbs,
  actions,
  children,
}: {
  isSignedIn: boolean;
  activeSlug: string;
  title: string;
  description?: string;
  breadcrumbs?: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [time, setTime] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const trail = useMemo(
    () => breadcrumbs ?? ["Home", title],
    [breadcrumbs, title],
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent text-foreground">
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
        <aside className="hidden w-16 shrink-0 border-r border-white/10 bg-slate-950 text-slate-300 shadow-[6px_0_28px_rgba(15,23,42,0.12)] md:flex md:flex-col md:items-center md:py-4">
          <div className="mb-5 grid size-10 place-items-center rounded-2xl bg-teal-500/15 text-teal-400">
            <Hammer className="size-5" />
          </div>
          <nav className="flex flex-1 flex-col items-center gap-1">
            {navigationItems.map((item) => (
              <Link
                key={item.slug}
                href={item.slug === "dashboard" ? "/" : `/${item.slug}`}
                className={cn(
                  "group relative grid size-10 place-items-center rounded-2xl transition-colors hover:bg-white/10 hover:text-white",
                  item.slug === activeSlug && "bg-teal-500/15 text-teal-300",
                )}
                aria-label={item.label}
              >
                {item.icon}
                <span className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-100 shadow-xl group-hover:block">
                  {item.label}
                </span>
              </Link>
            ))}
          </nav>
          <Link
            href="/sign-in"
            className="mt-auto grid size-10 place-items-center rounded-2xl bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronRight className="size-4" />
          </Link>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-white/60 bg-slate-950 text-white shadow-[0_10px_30px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-4">
                <div>
                  <p className="font-heading text-xl font-semibold tracking-tight text-teal-300">
                    BuildPro
                  </p>
                  <div className="hidden items-center gap-2 text-xs text-slate-400 md:flex">
                    {trail.map((segment, index) => (
                      <div key={segment} className="flex items-center gap-2">
                        {index > 0 ? (
                          <span className="text-slate-600">/</span>
                        ) : null}
                        <span
                          className={cn(
                            index === trail.length - 1 && "text-slate-100",
                          )}
                        >
                          {segment}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="hidden lg:block">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search projects, leads, quotes..."
                      className="h-10 w-64 rounded-2xl border-white/10 bg-white/5 pl-9 text-sm text-white placeholder:text-slate-400 focus-visible:ring-teal-500/30"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden text-right text-xs text-slate-400 md:block">
                  <div className="font-medium text-slate-200">
                    {time || "--:--:--"}
                  </div>
                  <div>AEST</div>
                </div>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative size-10 rounded-2xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                    onClick={() => setNotificationsOpen((value) => !value)}
                    aria-label="Notifications"
                  >
                    <Bell className="size-4" />
                    <span className="absolute right-1 top-1 size-2 rounded-full bg-orange-500" />
                  </Button>
                  {notificationsOpen ? (
                    <div className="absolute right-0 top-[calc(100%+0.75rem)] w-80 overflow-hidden rounded-3xl border border-border bg-background text-foreground shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
                      <div className="border-b border-border px-4 py-3">
                        <p className="font-semibold">Notifications</p>
                        <p className="text-xs text-muted-foreground">
                          Operational updates and reminders
                        </p>
                      </div>
                      <div className="space-y-1 p-2">
                        {tickerItems.map((item) => (
                          <div
                            key={item}
                            className="rounded-2xl px-3 py-2 text-sm hover:bg-muted/60"
                          >
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                {!isSignedIn ? (
                  <div className="flex items-center gap-2">
                    <SignInButton mode="modal">
                      <Button
                        variant="outline"
                        className="rounded-2xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                      >
                        Sign in
                      </Button>
                    </SignInButton>
                    <SignUpButton mode="modal">
                      <Button className="rounded-2xl bg-teal-500 text-slate-950 hover:bg-teal-400">
                        Sign up
                      </Button>
                    </SignUpButton>
                  </div>
                ) : (
                  <UserButton
                    appearance={{ elements: { avatarBox: "size-9" } }}
                  />
                )}
              </div>
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
            <section className="flex flex-col gap-4 rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-700/70">
                  BuildPro Operations
                </p>
                <h1 className="font-heading text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  {title}
                </h1>
                {description ? (
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-[15px]">
                    {description}
                  </p>
                ) : null}
              </div>
              {actions ? (
                <div className="flex flex-wrap gap-2">{actions}</div>
              ) : null}
            </section>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
