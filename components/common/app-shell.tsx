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
  type ShellCrumb,
} from "@/utils/shell-nav";
import Image from "next/image";
import { Notifications } from "./notifications";
import { PhoneDock } from "@/components/comms/phone-dock";
import { PhoneProvider } from "@/components/comms/phone-provider";
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
  phoneEnabled = false,
  operationsAgentEnabled,
  // description,
  breadcrumbs,
  // actions,
  children,
}: {
  isAdmin: boolean;
  isSignedIn: boolean;
  /**
   * Staff only: mounts the browser phone (calls and WhatsApp calls). A portal
   * account never asks for a calling credential or polls for calls.
   */
  phoneEnabled?: boolean;
  // EVE_OPERATIONS_AGENT_ENABLED. Off, the agent channel refuses every
  // request, so a nav entry would only lead to a workspace that cannot answer.
  operationsAgentEnabled: boolean;
  description?: string;
  breadcrumbs?: ShellCrumb[];
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
    // The fallback needs its unit: `calc(100dvh - 0)` is invalid, so outside
    // the sandbox (where the variable is unset) the height used to drop to
    // auto. The shell then grew with its content, the window scrolled instead
    // of <main>, and the agent workspace collapsed to its composer.
    <div className="relative h-[calc(100dvh-var(--sandbox-banner-height,0px))] overflow-hidden bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-background focus:p-3 focus:text-foreground focus:outline-2 focus:outline-ring"
      >
        Skip to content
      </a>
      {/* Clean Light Background matching Email Theme */}
      <div className="flex h-full">
        {/* ── Desktop Sidebar ── */}
        <aside className="hidden w-16 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col md:items-center md:py-4">
          <div className="mb-5 grid size-10 place-items-center rounded-lg bg-background">
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
                  "group relative grid size-10 place-items-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  item.slug === sectionSlug
                    && "bg-sidebar-accent text-sidebar-accent-foreground",
                  item.checkAdmin && !isAdmin && "hidden",
                )}
                aria-label={item.label}
                aria-current={item.slug === sectionSlug ? "page" : undefined}
              >
                {item.icon}
                {item.slug === sectionSlug ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-3 inset-y-2 w-[3px] rounded-r-full bg-royal-gold"
                  />
                ) : null}
                {/* Duplicate of the Link's aria-label; hide it from the a11y
                    tree so the item is not announced twice. z-50 lifts it
                    over the content column (and its z-30 top bar), which
                    otherwise paints across it. Keyboard focus shows it too. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-xl group-hover:block group-focus-visible:block"
                >
                  {item.label}
                </span>
              </Link>
            ))}
          </nav>
        </aside>

        {/* --topbar-h is the top bar's fixed height. The bar floats over <main>,
            which pads its top by the same amount, so the page scrolls up under
            frosted glass. Anything sticky inside <main> sticks at this offset. */}
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden [--topbar-h:3.5rem] sm:[--topbar-h:4.25rem]">
          {/* ── Mobile Sidebar Sheet ── */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-80 max-w-[calc(100vw-2rem)] border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-4 border-b border-sidebar-border px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background">
                      <Image
                        src="/favicon.ico"
                        alt="Royal Constructions Logo"
                        width={32}
                        height={32}
                      />
                    </div>
                    <div className="min-w-0">
                      <SheetTitle className="font-heading truncate text-base font-semibold text-sidebar-accent-foreground">
                        Royal Constructions
                      </SheetTitle>
                    </div>
                  </div>

                  <SheetClose asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-lg border border-sidebar-border bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-border hover:text-sidebar-accent-foreground"
                      aria-label="Close navigation menu"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </SheetClose>
                </div>

                <nav
                  aria-label="Main"
                  className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4"
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
                          "relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          item.slug === sectionSlug
                            && "bg-sidebar-accent text-sidebar-accent-foreground",
                          item.checkAdmin && !isAdmin && "hidden",
                        )}
                      >
                        {item.slug === sectionSlug ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-royal-gold"
                          />
                        ) : null}
                        <span
                          aria-hidden="true"
                          className="grid size-9 place-items-center rounded-lg"
                        >
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </SheetClose>
                  ))}
                </nav>

                {!isSignedIn ? (
                  <div className="border-t border-sidebar-border px-4 py-4">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 rounded-lg border-border bg-card text-foreground hover:bg-muted hover:text-foreground"
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
                  <div className="border-t border-sidebar-border px-4 py-4">
                    <UserButton
                      showName={true}
                      appearance={{
                        elements: {
                          avatarBox: "size-9",
                          userButtonBox:
                            "w-full! flex! flex-row-reverse!  gap-2 justify-end text-sidebar-foreground",
                          userButtonTrigger: "w-full",
                          userButtonOuterIdentifier:
                            "text-base text-sidebar-foreground!",
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
          {/* The one piece of glass in the app (DESIGN.md §8). Without
              backdrop-filter support the bar stays near-opaque cream. */}
          <header className="absolute inset-x-0 top-0 z-30 h-(--topbar-h) border-b border-border/70 bg-background/95 text-foreground supports-backdrop-filter:bg-background/75 supports-backdrop-filter:backdrop-blur-md supports-backdrop-filter:backdrop-saturate-150">
            <div className="flex h-full w-full items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-2 sm:gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-lg border border-border bg-muted text-muted-foreground hover:bg-border hover:text-foreground md:hidden"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open navigation menu"
                >
                  <Menu className="size-4" aria-hidden="true" />
                </Button>
                <div className="min-w-0">
                  <p className="font-heading truncate text-base font-semibold tracking-tight text-foreground sm:text-xl">
                    Royal Constructions
                  </p>
                  <p className="truncate text-xs text-foreground/80 md:hidden">
                    {title}
                  </p>
                  <nav
                    aria-label="Breadcrumb"
                    className="hidden min-w-0 md:block"
                  >
                    <ol className="flex min-w-0 items-center gap-2 text-xs whitespace-nowrap text-foreground/80">
                      {trail.map((crumb, index) => (
                        <li
                          key={`${crumb.label}-${index}`}
                          className="flex min-w-0 items-center gap-2 last:shrink"
                        >
                          {index > 0 ? (
                            <span
                              className="text-foreground/60"
                              aria-hidden="true"
                            >
                              /
                            </span>
                          ) : null}
                          {crumb.href ? (
                            <Link
                              href={crumb.href}
                              className="rounded-sm transition-colors hover:text-foreground hover:underline hover:underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              {crumb.label}
                            </Link>
                          ) : (
                            <span
                              aria-current="page"
                              className="truncate font-medium text-foreground"
                            >
                              {crumb.label}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </nav>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden text-right text-xs text-foreground/80 md:block">
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
                        className="rounded-lg border-border bg-card text-foreground hover:bg-muted hover:text-foreground"
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
            id="main-content"
            tabIndex={-1}
            className={cn(
              "min-h-0 min-w-0 w-full flex-1 gap-4 outline-none sm:gap-6",
              pathName.startsWith("/agent")
                ? // The workspace is its own full-height card; on a phone the
                  // gutter around it only takes room from the transcript, and
                  // the composer pads for the home indicator itself.
                  "grid h-0 grid-rows-[minmax(0,1fr)] overflow-hidden px-0 pt-(--topbar-h) pb-0 sm:px-6 sm:pt-[calc(var(--topbar-h)+1rem)] sm:pb-4 lg:px-8 lg:pt-[calc(var(--topbar-h)+1.5rem)] lg:pb-6"
                : "flex scroll-pt-(--topbar-h) flex-col overflow-y-auto px-3 pt-[calc(var(--topbar-h)+1rem)] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-[calc(var(--topbar-h)+1.5rem)] lg:pb-6",
              "scrollbar-none",
              "[-ms-overflow-style:none]",
              "[&::-webkit-scrollbar]:hidden",
            )}
          >
            {phoneEnabled ? (
              <PhoneProvider>
                {children}
                <PhoneDock />
              </PhoneProvider>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
