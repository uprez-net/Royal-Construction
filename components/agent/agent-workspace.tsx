"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEveAgent } from "eve/react";
import {
  Bot,
  CircleStop,
  History,
  MessageSquareText,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import {
  AgentMessage,
  type AgentInputResponse,
} from "@/components/agent/agent-message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { AgentSessionListItem } from "@/lib/data/agent-sessions";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Find the latest offer for a client",
  "Show the revision history for an offer",
  "Find a lead and list their open tasks",
] as const;

export function AgentWorkspace({
  initialSessions,
  selectedSessionId,
}: {
  initialSessions: AgentSessionListItem[];
  selectedSessionId: string | null;
}) {
  const router = useRouter();
  const [composer, setComposer] = useState("");
  const [sessions, setSessions] = useState(initialSessions);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sessionPathUpdated = useRef(Boolean(selectedSessionId));

  const onSessionChange = useCallback(
    (session: { sessionId: string; streamIndex: number } | undefined) => {
      if (!session) return;
      setSessions((current) => {
        if (current.some((item) => item.eveSessionId === session.sessionId)) {
          return current;
        }
        const now = new Date().toISOString();
        return [
          {
            agentName: "operations",
            createdAt: now,
            eveSessionId: session.sessionId,
            lastEventAt: now,
            status: "ACTIVE",
            summary: null,
            title: null,
            updatedAt: now,
          },
          ...current,
        ];
      });
      if (!sessionPathUpdated.current) {
        sessionPathUpdated.current = true;
        window.history.replaceState(null, "", `/agent/${session.sessionId}`);
      }
    },
    [],
  );

  const agent = useEveAgent({
    initialSession: selectedSessionId
      ? { sessionId: selectedSessionId, streamIndex: 0 }
      : undefined,
    onFinish: () => router.refresh(),
    onSessionChange,
    prepareSend: (payload) => ({
      ...payload,
      clientContext: {
        route: window.location.pathname,
      },
    }),
    resume: Boolean(selectedSessionId),
  });

  const busy = agent.status === "resuming" || agent.status === "submitted" || agent.status === "streaming";
  const canSend = !busy && composer.trim().length > 0;
  const statusLabel = useMemo(() => agentStatusLabel(agent.status), [agent.status]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [agent.data.messages, agent.status]);

  async function sendMessage(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    setComposer("");
    await agent.send(text);
  }

  async function respond(responses: readonly AgentInputResponse[]) {
    await agent.respond(responses);
  }

  return (
    <section className="grid min-h-[40rem] flex-1 overflow-hidden rounded-xl border border-border/70 bg-white shadow-sm md:h-[calc(100dvh-10.5rem)] md:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-border/70 bg-muted/25 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="font-heading text-base font-semibold text-foreground">Conversations</p>
            <p className="text-xs text-muted-foreground">Private to your account</p>
          </div>
          <Button asChild aria-label="New conversation" size="icon-sm" variant="outline">
            <Link href="/agent">
              <Plus data-icon="inline-start" />
            </Link>
          </Button>
        </div>
        <Separator />
        <ScrollArea className="max-h-44 flex-1 md:max-h-none">
          <nav aria-label="Agent conversations" className="flex gap-2 p-3 md:flex-col">
            {sessions.length === 0 ? (
              <div className="flex min-w-64 items-center gap-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground md:min-w-0">
                <History aria-hidden="true" className="size-4 shrink-0" />
                Your conversations will appear here.
              </div>
            ) : (
              sessions.map((session, index) => {
                const active = session.eveSessionId === (agent.session?.sessionId ?? selectedSessionId);
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "min-w-64 rounded-lg border px-3 py-3 transition-colors md:min-w-0",
                      active
                        ? "border-royal-gold/50 bg-royal-gold-light/55"
                        : "border-transparent hover:border-border hover:bg-white",
                    )}
                    href={`/agent/${session.eveSessionId}`}
                    key={session.eveSessionId}
                  >
                    <div className="flex items-start gap-2">
                      <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {session.title || `Operations conversation ${sessions.length - index}`}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted-foreground">
                            {formatSessionDate(session.lastEventAt ?? session.updatedAt)}
                          </span>
                          <span className={cn("size-1.5 shrink-0 rounded-full", statusDot(session.status))} />
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </nav>
        </ScrollArea>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-royal-gold-light text-royal-gold-ink">
              <Bot aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="font-heading truncate text-base font-semibold text-foreground sm:text-lg">
                Operations desk
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                Leads, offers and controlled business actions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              <span className={cn("size-1.5 rounded-full", busy ? "animate-pulse bg-royal-gold" : agent.status === "error" ? "bg-destructive" : "bg-emerald-600")} />
              {statusLabel}
            </Badge>
            {busy ? (
              <Button onClick={() => void agent.cancel()} size="sm" type="button" variant="outline">
                <CircleStop data-icon="inline-start" />
                <span className="hidden sm:inline">Stop</span>
              </Button>
            ) : null}
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
            {agent.data.messages.length === 0 && agent.status !== "resuming" ? (
              <Empty className="min-h-[24rem] border-0">
                <EmptyHeader>
                  <EmptyMedia className="size-12 rounded-xl bg-royal-gold-light text-royal-gold-ink" variant="icon">
                    <Sparkles aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle className="text-xl">What needs moving today?</EmptyTitle>
                  <EmptyDescription>
                    Ask for a live business lookup. The agent will show the exact target and ask before any controlled action.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="max-w-xl sm:grid sm:grid-cols-3">
                  {SUGGESTIONS.map((suggestion) => (
                    <Button
                      className="h-auto min-h-16 w-full justify-start whitespace-normal px-3 py-2 text-left"
                      key={suggestion}
                      onClick={() => void sendMessage(suggestion)}
                      type="button"
                      variant="outline"
                    >
                      {suggestion}
                    </Button>
                  ))}
                </EmptyContent>
              </Empty>
            ) : null}
            {agent.status === "resuming" ? (
              <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-royal-gold" />
                Restoring conversation…
              </div>
            ) : null}
            {agent.data.messages.map((message) => (
              <AgentMessage
                canRespond={!busy}
                isStreaming={agent.status === "streaming"}
                key={message.id}
                message={message}
                onInputResponses={respond}
              />
            ))}
            {agent.error ? (
              <Alert variant="destructive">
                <AlertTitle>The agent could not continue</AlertTitle>
                <AlertDescription>{agent.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </ScrollArea>

        <footer className="border-t border-border/70 bg-white p-3 sm:p-4">
          <form
            className="mx-auto max-w-4xl"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(composer);
            }}
          >
            <InputGroup className="rounded-xl bg-muted/20 shadow-xs">
              <InputGroupTextarea
                aria-label="Message the operations agent"
                className="min-h-20 max-h-40 px-3 pt-3"
                disabled={agent.status === "resuming"}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (canSend) void sendMessage(composer);
                  }
                }}
                placeholder="Ask about a lead, offer, task or project…"
                value={composer}
              />
              <InputGroupAddon align="block-end" className="justify-between">
                <span className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
                <Button aria-label="Send message" disabled={!canSend} size="icon-sm" type="submit">
                  <Send data-icon="inline-start" />
                </Button>
              </InputGroupAddon>
            </InputGroup>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Live business data is permission-scoped. Confirm important details before acting.
            </p>
          </form>
        </footer>
      </div>
    </section>
  );
}

function agentStatusLabel(status: ReturnType<typeof useEveAgent>["status"]) {
  const labels = {
    error: "Needs attention",
    ready: "Ready",
    resuming: "Restoring",
    streaming: "Working",
    submitted: "Starting",
  } as const;
  return labels[status];
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
