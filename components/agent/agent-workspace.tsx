"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEveAgent } from "eve/react";
import {
  ArrowDown,
  Bot,
  CircleStop,
  Archive,
  History,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  GitFork,
  LoaderCircle,
  Send,
  Sparkles,
} from "lucide-react";
import {
  AgentAnnotations,
  type AgentAnnotation,
} from "@/components/agent/agent-annotations";
import { AgentAttachments } from "@/components/agent/agent-attachments";
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
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [annotations, setAnnotations] = useState<AgentAnnotation[]>([]);
  const [annotationResults, setAnnotationResults] = useState<AgentAnnotation[]>(
    [],
  );
  const [forkContext, setForkContext] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : sessionStorage.getItem("rc-agent-fork-context"),
  );
  const [sessions, setSessions] = useState(initialSessions);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sessionPathUpdated = useRef(Boolean(selectedSessionId));
  const stickToBottomRef = useRef(true);

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
        router.replace(`/agent/${session.sessionId}`, { scroll: false });
      }
    },
    [router],
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

  const busy =
    agent.status === "resuming" ||
    agent.status === "submitted" ||
    agent.status === "streaming";
  const canSend =
    !busy && (composer.trim().length > 0 || attachments.length > 0);
  const annotationQuery = useMemo(
    () => composer.match(/(?:^|\s)@([^\s@]*)$/)?.[1] ?? "",
    [composer],
  );
  const statusLabel = useMemo(
    () => agentStatusLabel(agent.status),
    [agent.status],
  );
  const activeSessionId = agent.session?.sessionId ?? selectedSessionId;
  const activeSessionTitle =
    initialSessions.find((session) => session.eveSessionId === activeSessionId)
      ?.title ??
    sessions.find((session) => session.eveSessionId === activeSessionId)
      ?.title ??
    "New conversation";

  useEffect(() => {
    if (!activeSessionId) return;
    window.dispatchEvent(
      new CustomEvent("agent-session-title", {
        detail: {
          path: window.location.pathname,
          sessionId: activeSessionId,
          title: activeSessionTitle,
        },
      }),
    );
  }, [activeSessionId, activeSessionTitle]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [agent.data.messages, agent.status]);

  useEffect(() => {
    const query = annotationQuery;
    if (query.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/agent/annotations?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((response) =>
          response.ok ? response.json() : { annotations: [] },
        )
        .then((payload: { annotations?: typeof annotationResults }) =>
          setAnnotationResults(payload.annotations ?? []),
        )
        .catch(() => undefined);
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [annotationQuery]);

  async function sendMessage(message: string) {
    const text = message.trim() || "Please review the attached file(s).";
    if ((!message.trim() && attachments.length === 0) || busy) return;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    setSendError(null);
    try {
      const uploaded = await Promise.all(
        attachments.map(async (file) => {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch("/api/agent/upload", {
            method: "POST",
            body: form,
          });
          if (!response.ok) throw new Error("Attachment upload failed");
          return (
            (await response.json()) as {
              file: { url: string; filename: string; fileType: string };
            }
          ).file;
        }),
      );
      const content = [
        { type: "text" as const, text },
        ...uploaded.map((file) => ({
          type: "file" as const,
          data: new URL(file.url),
          filename: file.filename,
          mediaType: file.fileType,
        })),
      ];
      await agent.send(content, {
        clientContext: {
          route: window.location.pathname,
          forkContext,
          annotations: annotations.map(({ type, id, label }) => ({
            type,
            id,
            label,
          })),
        },
      });
      setComposer("");
      setAttachments([]);
      setAnnotations([]);
      setForkContext(null);
      setEditingMessageId(null);
      sessionStorage.removeItem("rc-agent-fork-context");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "The message could not be sent.");
    }
  }

  async function respond(responses: readonly AgentInputResponse[]) {
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    await agent.respond(responses);
  }

  async function runAction(action: {
    id: string;
    label: string;
    operation: string;
  }) {
    await sendMessage(
      `Please execute the approved UI action "${action.label}" (${action.operation}, action id ${action.id}) after I review the prepared details.`,
    );
  }

  function selectAnnotation(annotation: (typeof annotationResults)[number]) {
    setAnnotations((current) =>
      current.some(
        (item) => item.id === annotation.id && item.type === annotation.type,
      )
        ? current
        : [...current, annotation],
    );
    setComposer((current) => current.replace(/(?:^|\s)@[^\s@]*$/, " "));
    setAnnotationResults([]);
  }

  function forkConversation() {
    const transcript = agent.data.messages
      .flatMap((message) =>
        message.parts
          .filter((part) => part.type === "text")
          .map((part) => `${message.role}: ${part.text}`),
      )
      .join("\n")
      .slice(-12_000);
    sessionStorage.setItem("rc-agent-fork-context", transcript);
    router.push("/agent");
  }

  function editMessage(messageId: string, text: string) {
    setEditingMessageId(messageId);
    setComposer(text);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function handleMessageScroll(event: React.UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget;
    const atBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 48;
    if (stickToBottomRef.current === atBottom) return;
    stickToBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom);
  }

  function scrollToBottom() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    stickToBottomRef.current = true;
    setShowScrollToBottom(false);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }

  return (
    <section
      className={cn(
        "grid h-full max-h-full min-h-full w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-border/70 bg-white shadow-sm transition-[grid-template-columns] duration-200 md:grid-rows-[minmax(0,1fr)]",
        historyOpen
          ? "md:grid-cols-[18rem_minmax(0,1fr)]"
          : "md:grid-cols-[0_minmax(0,1fr)]",
      )}
    >
      <aside
        aria-hidden={!historyOpen}
        className={cn(
          "order-2 grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border-b border-border/70 bg-muted/25 transition-[max-height,opacity] duration-200 md:order-1 md:border-b-0 md:border-r md:transition-opacity",
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
                      onClick={async (event) => {
                        event.preventDefault();
                        const response = await fetch(
                          `/api/agent/sessions/${session.eveSessionId}/archive`,
                          { method: "POST" },
                        );
                        if (response.ok)
                          setSessions((items) =>
                            items.filter(
                              (item) =>
                                item.eveSessionId !== session.eveSessionId,
                            ),
                          );
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

      <div className="order-1 grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden md:order-2">
        <header className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-controls="agent-conversation-history"
              aria-expanded={historyOpen}
              aria-label={
                historyOpen
                  ? "Collapse conversation history"
                  : "Expand conversation history"
              }
              onClick={() => setHistoryOpen((open) => !open)}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              {historyOpen ? (
                <PanelLeftClose aria-hidden="true" />
              ) : (
                <PanelLeftOpen aria-hidden="true" />
              )}
            </Button>
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
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  busy
                    ? "animate-pulse bg-royal-gold"
                    : agent.status === "error"
                      ? "bg-destructive"
                      : "bg-emerald-600",
                )}
              />
              {statusLabel}
            </Badge>
            {busy ? (
              <Button
                onClick={() => void agent.cancel()}
                size="sm"
                type="button"
                variant="outline"
              >
                <CircleStop data-icon="inline-start" />
                <span className="hidden sm:inline">Stop</span>
              </Button>
            ) : null}
            {agent.data.messages.length > 0 ? (
              <Button
                aria-label="Fork conversation"
                onClick={forkConversation}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <GitFork />
              </Button>
            ) : null}
          </div>
        </header>

        <div className="relative h-[60vh] overflow-hidden">
          <div
            className="absolute  inset-0 overflow-y-auto overscroll-contain"
            onScroll={handleMessageScroll}
            ref={viewportRef}
          >
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
              {agent.data.messages.length === 0 &&
              agent.status !== "resuming" ? (
                <Empty className="min-h-96 border-0">
                  <EmptyHeader>
                    <EmptyMedia
                      className="size-12 rounded-xl bg-royal-gold-light text-royal-gold-ink"
                      variant="icon"
                    >
                      <Sparkles aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle className="text-xl">
                      What needs moving today?
                    </EmptyTitle>
                    <EmptyDescription>
                      Ask for a live business lookup. The agent will show the
                      exact target and ask before any controlled action.
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
                  onAction={runAction}
                  onEditMessage={editMessage}
                  message={message}
                  onInputResponses={respond}
                />
              ))}
              {agent.status === "streaming" ? (
                <div className="flex items-center gap-2 self-start rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Live response · assembling the next operation step…
                </div>
              ) : null}
              {agent.error ? (
                <Alert variant="destructive">
                  <AlertTitle>The agent could not continue</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center gap-3">
                    <span>{agent.error.message}</span>
                    <Button
                      onClick={() => void agent.resume()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Retry stream
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              {sendError ? (
                <Alert variant="destructive">
                  <AlertTitle>The message could not be sent</AlertTitle>
                  <AlertDescription>{sendError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </div>
          {showScrollToBottom ? (
            <Button
              aria-label="Scroll to the latest message"
              className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border-border/80 bg-white/95 text-foreground shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:bg-royal-gold-light"
              onClick={scrollToBottom}
              size="icon-sm"
              title="Scroll to latest message"
              type="button"
              variant="outline"
            >
              <ArrowDown aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <footer className="relative z-10 shrink-0 border-t border-border/70 bg-white p-3 sm:p-4">
          <form
            className="relative mx-auto max-w-4xl"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(composer);
            }}
          >
            {editingMessageId ? (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-royal-gold/30 bg-royal-gold-light/35 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Editing a previous message. Send it to start a new turn.
                </span>
                <Button
                  onClick={() => {
                    setEditingMessageId(null);
                    setComposer("");
                  }}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            ) : null}
            <AgentAnnotations
              annotations={annotations}
              setAnnotations={setAnnotations}
              annotationResults={annotationResults}
              annotationQuery={annotationQuery}
              selectAnnotation={selectAnnotation}
            />
            <InputGroup className="rounded-xl bg-muted/20 shadow-xs">
              <InputGroupTextarea
                aria-label="Message the operations agent"
                 className={cn(
                   "min-h-20 max-h-40 px-3",
                   annotations.length > 0 ? "pt-12" : "pt-3",
                 )}
                disabled={agent.status === "resuming"}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (canSend) void sendMessage(composer);
                  }
                }}
                placeholder="Ask about a lead, offer, task or project…"
                ref={composerRef}
                value={composer}
              />
              <InputGroupAddon
                align="block-end"
                className="justify-between gap-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <AgentAttachments
                    attachments={attachments}
                    setAttachments={setAttachments}
                  />
                  <span className="hidden shrink-0 sm:inline">
                    Enter to send · Shift+Enter for a new line · @ to reference
                  </span>
                </span>
                <Button
                  aria-label="Send message"
                  disabled={!canSend}
                  size="icon-sm"
                  type="submit"
                >
                  <Send data-icon="inline-start" />
                </Button>
              </InputGroupAddon>
            </InputGroup>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Live business data is permission-scoped. Confirm important details
              before acting.
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
