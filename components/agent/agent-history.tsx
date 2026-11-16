"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  History,
  MessageSquareText,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentSessionListItem } from "@/lib/data/agent-sessions";
import { SYDNEY_TZ } from "@/lib/dates/sydney";
import { cn } from "@/lib/utils";

/**
 * The conversation rail.
 *
 * It fills whatever holds it: a fixed column on a wide screen, a drawer on a
 * narrow one. It used to carry its own responsive behaviour — collapsing to an
 * 80px accordion that pushed the transcript down on a phone — which the
 * workspace now owns instead.
 */
export function AgentHistory({
  activeSessionId,
  activeSessionTitle,
  initialSessions,
  onArchive,
  onClose,
  onNavigate,
  sessions,
}: {
  activeSessionId: string | null;
  activeSessionTitle: string;
  initialSessions: AgentSessionListItem[];
  onArchive: (sessionId: string) => Promise<void>;
  /** Given when the rail is a drawer, which then needs its own way out. */
  onClose?: () => void;
  onNavigate?: () => void;
  sessions: AgentSessionListItem[];
}) {
  const [query, setQuery] = useState("");

  const titleFor = useMemo(() => {
    const persisted = new Map(
      initialSessions.map((item) => [item.eveSessionId, item.title]),
    );
    return (session: AgentSessionListItem) =>
      persisted.get(session.eveSessionId)
      || session.title
      || (session.eveSessionId === activeSessionId ? activeSessionTitle : null)
      || "New conversation";
  }, [activeSessionId, activeSessionTitle, initialSessions]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) =>
      titleFor(session).toLowerCase().includes(needle),
    );
  }, [query, sessions, titleFor]);

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col bg-muted/25"
      id="agent-conversation-history"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <p className="text-sm font-semibold text-foreground">Conversations</p>
        <div className="flex items-center gap-1">
          <Button
            asChild
            aria-label="New conversation"
            size="icon-sm"
            variant="outline"
          >
            <Link href="/agent" onClick={onNavigate}>
              <Plus data-icon="inline-start" />
            </Link>
          </Button>
          {onClose ? (
            <Button
              aria-label="Close conversations"
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          ) : null}
        </div>
      </div>

      {sessions.length > 3 ? (
        <div className="relative px-3 pb-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter conversations"
            className="h-8 pl-7 text-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter"
            value={query}
          />
        </div>
      ) : null}

      <nav
        aria-label="Agent conversations"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2 pb-3"
      >
        {sessions.length === 0 ? (
          <p className="mx-1 flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <History aria-hidden="true" className="size-4 shrink-0" />
            Your conversations will appear here.
          </p>
        ) : visible.length === 0 ? (
          <p className="mx-1 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            No conversation matches “{query}”.
          </p>
        ) : (
          visible.map((session) => {
            const active = session.eveSessionId === activeSessionId;
            return (
              <div className="group relative" key={session.eveSessionId}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block rounded-lg border px-2.5 py-2 pr-9 transition-colors pointer-coarse:py-3 pointer-coarse:pr-14",
                    active
                      ? "border-royal-gold/50 bg-royal-gold-light/55"
                      : "border-transparent hover:border-border hover:bg-card",
                  )}
                  href={`/agent/${session.eveSessionId}`}
                  onClick={onNavigate}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquareText
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {titleFor(session)}
                      </p>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-muted-foreground">
                          {formatSessionDate(
                            session.lastEventAt ?? session.updatedAt,
                          )}
                        </span>
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            statusDot(session.status),
                          )}
                          title={session.status.toLowerCase()}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
                <Button
                  aria-label={`Archive ${titleFor(session)}`}
                  className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:top-1/2 pointer-coarse:-translate-y-1/2 pointer-coarse:opacity-100"
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
  );
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: SYDNEY_TZ,
  }).format(new Date(value));
}

function statusDot(status: AgentSessionListItem["status"]) {
  if (status === "FAILED") return "bg-destructive";
  if (status === "WAITING") return "bg-warning";
  if (status === "ACTIVE") return "bg-success";
  return "bg-muted-foreground/45";
}
