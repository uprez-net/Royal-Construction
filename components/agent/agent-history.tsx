"use client";

import Link from "next/link";
import { Archive, History, MessageSquareText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { AgentSessionListItem } from "@/lib/data/agent-sessions";
import { cn } from "@/lib/utils";

export function AgentHistory({
  activeSessionId,
  activeSessionTitle,
  historyOpen,
  initialSessions,
  onArchive,
  sessions,
}: {
  activeSessionId: string | null;
  activeSessionTitle: string;
  historyOpen: boolean;
  initialSessions: AgentSessionListItem[];
  onArchive: (sessionId: string) => Promise<void>;
  sessions: AgentSessionListItem[];
}) {
  return (
    <aside
      aria-hidden={!historyOpen}
      className={cn(
        "order-2 grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border-b border-border/70 bg-muted/25 transition-[max-height,opacity] duration-200 md:border-b-0 md:border-l md:border-r-0 md:transition-opacity",
        historyOpen
          ? "max-h-80 opacity-100 md:max-h-none"
          : "pointer-events-none max-h-0 opacity-0 md:max-h-none",
      )}
      id="agent-conversation-history"
    >
      <div className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="font-heading text-base font-semibold text-foreground">
            Conversations
          </p>
          <p className="text-xs text-muted-foreground">
            Private to your account
          </p>
        </div>
        <Button
          asChild
          aria-label="New conversation"
          size="icon-sm"
          variant="outline"
        >
          <Link href="/agent">
            <Plus data-icon="inline-start" />
          </Link>
        </Button>
      </div>
      <Separator />
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <nav
          aria-label="Agent conversations"
          className="flex min-h-0 flex-col gap-2 p-3"
        >
          {sessions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              <History aria-hidden="true" className="size-4 shrink-0" />
              Your conversations will appear here.
            </div>
          ) : (
            sessions.map((session) => {
              const active = session.eveSessionId === activeSessionId;
              const title =
                initialSessions.find(
                  (item) => item.eveSessionId === session.eveSessionId,
                )?.title ||
                session.title ||
                (active ? activeSessionTitle : null) ||
                "New conversation";
              return (
                <div className="group relative" key={session.eveSessionId}>
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-lg border px-3 py-3 pr-9 transition-colors",
                      active
                        ? "border-royal-gold/50 bg-royal-gold-light/55"
                        : "border-transparent hover:border-border hover:bg-white",
                    )}
                    href={`/agent/${session.eveSessionId}`}
                  >
                    <div className="flex items-start gap-2">
                      <MessageSquareText
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {title}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted-foreground">
                            {formatSessionDate(
                              session.lastEventAt ?? session.updatedAt,
                            )}
                          </span>
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              statusDot(session.status),
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </Link>
                  <Button
                    aria-label="Archive conversation"
                    className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={(event) => {
                      event.preventDefault();
                      void onArchive(session.eveSessionId);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Archive />
                  </Button>
                </div>
              );
            })
          )}
        </nav>
      </div>
    </aside>
  );
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function statusDot(status: AgentSessionListItem["status"]) {
  if (status === "FAILED") return "bg-destructive";
  if (status === "WAITING") return "bg-amber-500";
  if (status === "ACTIVE") return "bg-emerald-600";
  return "bg-muted-foreground/45";
}
