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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  const [queryClient] = useState(() => new QueryClient());
  const [time, setTime] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeProject = useAppSelector((state) => state.projects.activeProject);
  const activeTradie = useAppSelector((state) => state.tradieManagement.selectedTradieDetails);
  const pathName = usePathname();
  const lastSegment = pathName.split("/").filter(Boolean).pop() ?? "";
  const activeSlug = isUUID(lastSegment)
    ? "Loading..."
    : (pathName.split("/").pop() ?? "dashboard");
  const title = activeProject ? activeProject.name : activeTradie ? activeTradie.name : getScreenTitle(activeSlug);
  const isOfferDetailPage = /^\/offers\/[^/]+$/.test(pathName);

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
    <div className="relative min-h-screen overflow-hidden bg-[#F7F6F2] text-slate-900">
      {/* Clean Light Background matching Email Theme */}
      <div className="flex min-h-screen">
        
        {/* ── Desktop Sidebar ── */}
        <aside className="hidden w-16 shrink-0 border-r border-[#E2E8F0] bg-white text-slate-600 shadow-sm md:flex md:flex-col md:items-center md:py-4">
          <div className="mb-5 grid size-10 place-items-center rounded-2xl bg-[#F7F6F2]">
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
                  "group relative grid size-10 place-items-center rounded-lg transition-colors hover:bg-slate-100 hover:text-slate-900",
                  item.slug === activeSlug && "bg-[#C6923A]/10 text-[#C6923A]"
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
          
          {/* ── Mobile Sidebar Sheet ── */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-80 border-r border-[#E2E8F0] bg-white p-0 text-slate-900"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#F7F6F2]">
                      <Image
                        src="/favicon.ico"
                        alt="Royal Constructions Logo"
                        width={32}
                        height={32}
                      />
                    </div>
                    <div className="min-w-0">
                      <SheetTitle className="font-heading truncate text-base font-semibold text-slate-900">
                        Royal Constructions
                      </SheetTitle>
                    </div>
                  </div>

                  <SheetClose asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-lg border border-[#E2E8F0] bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
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
                          "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors hover:bg-slate-100 hover:text-slate-900",
                          item.slug === activeSlug
                            ? "bg-[#C6923A]/10 text-[#C6923A]"
                            : "text-slate-600"
                        )}
                      >
                        <span className={cn(
                          "grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-500",
                          item.slug === activeSlug && "bg-[#C6923A]/10 text-[#C6923A]"
                        )}>
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </SheetClose>
                  ))}
                </nav>

                {!isSignedIn ? (
                  <div className="border-t border-[#E2E8F0] px-4 py-4">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 rounded-lg border-[#E2E8F0] bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                        asChild
                      >
                        <Link href="/sign-in">Sign in</Link>
                      </Button>
                      <Button
                        className="flex-1 rounded-lg bg-[#C6923A] text-white hover:bg-[#C6923A]/90"
                        asChild
                      >
                        <Link href="/sign-up">Sign up</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-[#E2E8F0] px-4 py-4">
                    <UserButton
                      showName={true}
                      appearance={{
                        elements: {
                          avatarBox: "size-9",
                          userButtonBox:
                            "w-full! flex! flex-row-reverse!  gap-2 justify-end text-slate-900",
                          userButtonTrigger: "w-full",
                          userButtonOuterIdentifier: "text-base text-slate-900",
                          userButtonAvatarBox: "w-8 h-8",
                          rootBox: "w-full shadow-xs",
                        },
                      }}
                      userProfileProps={{
                        appearance: {
                          baseTheme: "light",
                        },
                      }}
                    />
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          {/* ── Top Header ── */}
          <header className="sticky top-0 z-30 border-b border-[#E2E8F0] bg-white text-slate-900 shadow-sm backdrop-blur">
            <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-lg border border-[#E2E8F0] bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 md:hidden"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open navigation menu"
                >
                  <Menu className="size-4" />
                </Button>
                <div>
                  <p className="font-heading text-xl font-semibold tracking-tight text-[#C6923A]">
                    Royal Constructions
                  </p>
                  <div className="hidden items-center gap-2 text-xs text-slate-500 md:flex">
                    {trail.map((segment, index) => (
                      <div key={segment} className="flex items-center gap-2">
                        {index > 0 ? (
                          <span className="text-slate-300">/</span>
                        ) : null}
                        <span
                          className={cn(
                            index === trail.length - 1 && "font-medium text-slate-900",
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
                <div className="hidden text-right text-xs text-slate-500 md:block">
                  <div className="font-medium text-slate-900">
                    {time || "--:--:--"}
                  </div>
                  <div>AEST</div>
                </div>
                <QueryClientProvider client={queryClient}>
                  <NotificationProvider>
                    <TooltipProvider>
                      <Notifications />
                    </TooltipProvider>
                  </NotificationProvider>
                </QueryClientProvider>
                <div className="hidden md:block">
                  {!isSignedIn ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="rounded-lg border-[#E2E8F0] bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                        asChild
                      >
                        <Link href="/sign-in">Sign in</Link>
                      </Button>
                      <Button
                        className="rounded-lg bg-[#C6923A] text-white hover:bg-[#C6923A]/90"
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
              "mx-auto flex h-[calc(100dvh-65px)] w-full flex-1 flex-col gap-6",
              isOfferDetailPage ? "max-w-none" : "max-w-screen-2xl",
              "overflow-y-auto",
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
