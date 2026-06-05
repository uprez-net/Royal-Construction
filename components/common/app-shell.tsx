"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { navigationItems } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePathname } from "next/navigation";
import { useAppSelector } from "@/lib/store/hooks";
import { isUUID } from "@/utils/parser";
import { getScreenTitle } from "@/utils/uiHelper";
import Image from "next/image";
import { Notifications } from "./notifications";
import { NotificationProvider } from "@/context/NotificationContext";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppShell({
  isSignedIn,
  // description,
  breadcrumbs,
  // actions,
  children,
}: {
  isSignedIn: boolean;
  description?: string;
  breadcrumbs?: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [time, setTime] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeProject = useAppSelector((state) => state.projects.activeProject);
  const pathName = usePathname();
  const lastSegment = pathName.split("/").filter(Boolean).pop() ?? "";
  const activeSlug = isUUID(lastSegment)
    ? "Loading..."
    : (pathName.split("/").pop() ?? "dashboard");
  const title = activeProject ? activeProject.name : getScreenTitle(activeSlug);

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
        <aside className="hidden w-16 shrink-0 border-r border-white/10 bg-[oklch(0.16_0.03_249.8)] text-slate-300 shadow-[6px_0_28px_rgba(15,23,42,0.12)] md:flex md:flex-col md:items-center md:py-4">
          <div className="mb-5 grid size-10 place-items-center rounded-2xl bg-white">
            <Image
              src="/favicon.ico"
              alt="Royal Constructions Logo"
              width={32}
              height={32}
            />
          </div>
          <nav className="flex flex-1 flex-col items-center gap-1">
            {navigationItems.map((item) => (
              <Link
                key={item.slug}
                href={`/${item.slug}`}
                className={cn(
                  "group relative grid size-10 place-items-center rounded-lg transition-colors hover:bg-white/10 hover:text-white",
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
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-80 border-r border-white/10 bg-[oklch(0.16_0.03_249.8)] p-0 text-slate-200"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white">
                      <Image
                        src="/favicon.ico"
                        alt="Royal Constructions Logo"
                        width={32}
                        height={32}
                      />
                    </div>
                    <div className="min-w-0">
                      <SheetTitle className="font-heading truncate text-base font-semibold text-white">
                        Royal Constructions
                      </SheetTitle>
                    </div>
                  </div>

                  <SheetClose asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                      aria-label="Close navigation menu"
                    >
                      <X className="size-4" />
                    </Button>
                  </SheetClose>
                </div>

                <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
                  {navigationItems.map((item) => (
                    <SheetClose key={item.slug} asChild>
                      <Link
                        onClick={() => setMobileNavOpen(false)}
                        href={`/${item.slug}`}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors hover:bg-white/10 hover:text-white",
                          item.slug === activeSlug
                            ? "bg-teal-500/15 text-teal-300"
                            : "text-slate-300",
                        )}
                      >
                        <span className="grid size-9 place-items-center rounded-lg bg-white/5 text-slate-200">
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </SheetClose>
                  ))}
                </nav>

                {!isSignedIn ? (
                  <div className="border-t border-white/10 px-4 py-4">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 rounded-lg border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                        asChild
                      >
                        <Link href="/sign-in">Sign in</Link>
                      </Button>
                      <Button
                        className="flex-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                        asChild
                      >
                        <Link href="/sign-up">Sign up</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-white/10 px-4 py-4">
                    <UserButton
                      showName={true}
                      appearance={{
                        elements: {
                          avatarBox: "size-9",
                          userButtonBox:
                            "w-full! flex! flex-row-reverse!  gap-2 justify-end text-white",
                          userButtonTrigger: "w-full",
                          userButtonOuterIdentifier: "text-base text-white",
                          userButtonAvatarBox: "w-8 h-8",
                          rootBox: "w-full shadow-xs",
                        },
                        baseTheme: "dark",
                      }}
                      userProfileProps={{
                        appearance: {
                          baseTheme: "dark",
                        },
                      }}
                    />
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          <header className="sticky top-0 z-30 border-b border-white/60 bg-[oklch(0.16_0.03_249.8)] text-white shadow-[0_10px_30px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white md:hidden"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open navigation menu"
                >
                  <Menu className="size-4" />
                </Button>
                <div>
                  <p className="font-heading text-xl font-semibold tracking-tight text-teal-300">
                    Royal Constructions
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
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden text-right text-xs text-slate-400 md:block">
                  <div className="font-medium text-slate-200">
                    {time || "--:--:--"}
                  </div>
                  <div>AEST</div>
                </div>
                <NotificationProvider>
                  <TooltipProvider>
                    <Notifications />
                  </TooltipProvider>
                </NotificationProvider>
                <div className="hidden md:block">
                  {!isSignedIn ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="rounded-lg border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                        asChild
                      >
                        <Link href="/sign-in">Sign in</Link>
                      </Button>
                      <Button
                        className="rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                        asChild
                      >
                        <Link href="/sign-up">Sign up</Link>
                      </Button>
                    </div>
                  ) : (
                    <UserButton
                      appearance={{
                        elements: {
                          avatarBox: "size-9",
                        },
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </header>

          <main
            className={cn(
              "mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6",
              "overflow-y-auto",
              "max-h-[90vh]",
              "px-4 py-5 sm:px-6 lg:px-8 lg:py-6",
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
