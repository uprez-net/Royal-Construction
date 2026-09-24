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
import {
  getScreenTitle,
  getShellSectionSlug,
  getShellTrail,
} from "@/utils/shell-nav";
import Image from "next/image";
import { Notifications } from "./notifications";
import { NotificationProvider } from "@/context/NotificationContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SYDNEY_TZ, sydneyTimeZoneAbbreviation } from "@/lib/dates/sydney";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type AgentSessionTitleDetail = {
  path: string;
  sessionId: string;
  title: string;
};

export function AppShell({
  isAdmin,
  isSignedIn,
  operationsAgentEnabled,
  // description,
  breadcrumbs,
  // actions,
  children,
}: {
  isAdmin: boolean;
  isSignedIn: boolean;
  // EVE_OPERATIONS_AGENT_ENABLED. Off, the agent channel refuses every
  // request, so a nav entry would only lead to a workspace that cannot answer.
  operationsAgentEnabled: boolean;
  description?: string;
  breadcrumbs?: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const visibleNavigationItems = useMemo(
    () =>
      navigationItems.filter(
        (item) => item.slug !== "agent" || operationsAgentEnabled,
      ),
    [operationsAgentEnabled],
  );
  const [time, setTime] = useState("");
  const [zone, setZone] = useState<"AEST" | "AEDT">("AEST");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [agentSessionTitle, setAgentSessionTitle] =
    useState<AgentSessionTitleDetail | null>(null);
  const activeProject = useAppSelector((state) => state.projects.activeProject);
  const activeTradie = useAppSelector(
    (state) => state.tradieManagement.selectedTradieDetails,
  );
  const pathName = usePathname();
  const lastSegment = pathName.split("/").filter(Boolean).pop() ?? "";
  const sectionSlug = getShellSectionSlug(pathName);
  const titleSlug = isUUID(lastSegment) ? "Loading..." : lastSegment;
  const isAgentSessionRoute = pathName.startsWith("/agent/");
  const title = activeProject
    ? activeProject.name
    : activeTradie
      ? activeTradie.name
      : isAgentSessionRoute && agentSessionTitle?.path === pathName
        ? agentSessionTitle.title
        : isAgentSessionRoute
          ? "Conversation"
          : getScreenTitle(titleSlug);

  useEffect(() => {
    const handleAgentSessionTitle = (event: Event) => {
      const detail = (event as CustomEvent<AgentSessionTitleDetail>).detail;
      if (!detail?.path || !detail.title) return;
      setAgentSessionTitle(detail);
    };

    window.addEventListener("agent-session-title", handleAgentSessionTitle);
    return () =>
      window.removeEventListener(
        "agent-session-title",
        handleAgentSessionTitle,
      );
  }, []);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      // Labelled as Sydney time, so it has to be Sydney time: it used the
      // browser's zone, and read "AEST" even during daylight saving.
      setTime(
        now.toLocaleTimeString("en-AU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: SYDNEY_TZ,
        }),
      );
      setZone(sydneyTimeZoneAbbreviation(now));
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const trail = useMemo(
    () => breadcrumbs ?? getShellTrail(pathName, title),
    [breadcrumbs, pathName, title],
  );

  return (
    <div className="relative h-[calc(100dvh-var(--sandbox-banner-height,0))] overflow-hidden bg-[#F7F6F2] text-foreground">
      {/* Clean Light Background matching Email Theme */}
      <div className="flex h-full">
        {/* ── Desktop Sidebar ── */}
        <aside className="hidden w-16 shrink-0 border-r border-border bg-white text-muted-foreground shadow-sm md:flex md:flex-col md:items-center md:py-4">
          <div className="mb-5 grid size-10 place-items-center rounded-2xl bg-[#F7F6F2]">
            <Image
              src="/favicon.ico"
              alt="Royal Constructions Logo"
              width={32}
              height={32}
            />
          </div>
          <nav
            aria-label="Main"
            className="flex flex-1 flex-col items-center gap-1"
          >
            {visibleNavigationItems.map((item) => (
              <Link
                key={item.slug}
                href={`/${item.slug}`}
                className={cn(
                  "group relative grid size-10 place-items-center rounded-lg transition-colors hover:bg-muted hover:text-foreground",
                  item.slug === sectionSlug
                    && "bg-royal-gold-light text-royal-gold-ink",
                  item.checkAdmin && !isAdmin && "hidden",
                )}
                aria-label={item.label}
                aria-current={item.slug === sectionSlug ? "page" : undefined}
              >
                {item.icon}
                {/* Duplicate of the Link's aria-label; hide it from the a11y
                    tree so the item is not announced twice. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-xl group-hover:block"
                >
                  {item.label}
                </span>
              </Link>
            ))}
          </nav>
        </aside>

        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* ── Mobile Sidebar Sheet ── */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-80 border-r border-border bg-white p-0 text-foreground"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4">
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
                      <SheetTitle className="font-heading truncate text-base font-semibold text-foreground">
                        Royal Constructions
                      </SheetTitle>
                    </div>
                  </div>

                  <SheetClose asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-lg border border-border bg-muted text-muted-foreground hover:bg-border hover:text-foreground"
                      aria-label="Close navigation menu"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </SheetClose>
                </div>

                <nav
                  aria-label="Main"
                  className="flex flex-1 flex-col gap-1 px-3 py-4"
                >
                  {visibleNavigationItems.map((item) => (
                    <SheetClose key={item.slug} asChild>
                      <Link
                        onClick={() => setMobileNavOpen(false)}
                        href={`/${item.slug}`}
                        aria-current={
                          item.slug === sectionSlug ? "page" : undefined
                        }
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground",
                          item.slug === sectionSlug
                            ? "bg-royal-gold-light text-royal-gold-ink"
                            : "text-muted-foreground",
                          item.checkAdmin && !isAdmin && "hidden",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground",
                            item.slug === sectionSlug
                              && "bg-royal-gold-light text-royal-gold-ink",
                          )}
                        >
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </SheetClose>
                  ))}
                </nav>

                {!isSignedIn ? (
                  <div className="border-t border-border px-4 py-4">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 rounded-lg border-border bg-white text-foreground hover:bg-muted hover:text-foreground"
                        asChild
                      >
                        <Link href="/sign-in">Sign in</Link>
                      </Button>
                      <Button
                        variant="royal"
                        className="flex-1 rounded-lg"
                        asChild
                      >
                        <Link href="/sign-up">Sign up</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-border px-4 py-4">
                    <UserButton
                      showName={true}
                      appearance={{
                        elements: {
                          avatarBox: "size-9",
                          userButtonBox:
                            "w-full! flex! flex-row-reverse!  gap-2 justify-end text-foreground",
                          userButtonTrigger: "w-full",
                          userButtonOuterIdentifier:
                            "text-base text-foreground",
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
          <header className="shrink-0 z-30 border-b border-border bg-white text-foreground shadow-sm backdrop-blur">
            <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-lg border border-border bg-muted text-muted-foreground hover:bg-border hover:text-foreground md:hidden"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open navigation menu"
                >
                  <Menu className="size-4" aria-hidden="true" />
                </Button>
                <div>
                  <p className="font-heading text-xl font-semibold tracking-tight text-royal-gold-ink">
                    Royal Constructions
                  </p>
                  <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
                    {trail.map((segment, index) => (
                      <div key={segment} className="flex items-center gap-2">
                        {index > 0 ? (
                          <span
                            className="text-muted-foreground/50"
                            aria-hidden="true"
                          >
                            /
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            index === trail.length - 1
                              && "font-medium text-foreground",
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
                <div className="hidden text-right text-xs text-muted-foreground md:block">
                  <div className="font-medium text-foreground">
                    {time || "--:--:--"}
                  </div>
                  <div>{zone}</div>
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
                        className="rounded-lg border-border bg-white text-foreground hover:bg-muted hover:text-foreground"
                        asChild
                      >
                        <Link href="/sign-in">Sign in</Link>
                      </Button>
                      <Button variant="royal" className="rounded-lg" asChild>
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
              "min-h-0 w-full flex-1 gap-6",
              pathName.startsWith("/agent")
                ? "grid h-0 grid-rows-[minmax(0,1fr)] overflow-hidden"
                : "flex flex-col overflow-y-auto",
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
