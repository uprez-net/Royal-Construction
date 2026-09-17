"use client";

import type { EveMessage, UseEveAgentStatus } from "eve/react";
import {
  ArrowDown,
  Bot,
  CircleStop,
  GitFork,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from "lucide-react";
import type { RefObject } from "react";
import {
  AgentSubagentActivity,
  type AgentSubagentActivityRecord,
} from "@/components/agent/agent-subagent-activity";
import {
  AgentMessage,
  type AgentInputResponse,
} from "@/components/agent/agent-message";
import type { AgentAnnotation } from "@/components/agent/agent-annotations";
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
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Find the latest offer for a client",
  "Show the revision history for an offer",
  "Find a lead and list their open tasks",
] as const;

export function AgentTranscript({
  agentError,
  agentStatus,
  archiveError,
  busy,
  forkConversation,
  handleMessageScroll,
  hiddenMessageIds,
  historyOpen,
  messageAnnotations,
  messages,
  onAction,
  onCancel,
  onEditMessage,
  onRespond,
  onRetry,
  onSuggestion,
  onToggleHistory,
  pendingMessageAnnotations,
  scrollToBottom,
  sendError,
  showScrollToBottom,
  statusLabel,
  subagentActivities,
  viewportRef,
}: {
  agentError: Error | null;
  agentStatus: UseEveAgentStatus;
  archiveError: string | null;
  busy: boolean;
  forkConversation: () => void;
  handleMessageScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  hiddenMessageIds: Record<string, true>;
  historyOpen: boolean;
  messageAnnotations: Record<string, AgentAnnotation[]>;
  messages: readonly EveMessage[];
  onAction: (action: {
    id: string;
    label: string;
    operation: string;
  }) => Promise<void>;
  onCancel: () => void;
  onEditMessage: (messageId: string, text: string) => void;
  onRespond: (responses: readonly AgentInputResponse[]) => Promise<void>;
  onRetry: () => void;
  onSuggestion: (suggestion: string) => void;
  onToggleHistory: () => void;
  pendingMessageAnnotations: AgentAnnotation[] | null;
  scrollToBottom: () => void;
  sendError: string | null;
  showScrollToBottom: boolean;
  statusLabel: string;
  subagentActivities: readonly AgentSubagentActivityRecord[];
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  return (
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
            onClick={onToggleHistory}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            {historyOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
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
                  : agentStatus === "error"
                    ? "bg-destructive"
                    : "bg-emerald-600",
              )}
            />
            {statusLabel}
          </Badge>
          {busy ? (
            <Button
              onClick={onCancel}
              size="sm"
              type="button"
              variant="outline"
            >
              <CircleStop data-icon="inline-start" />
              <span className="hidden sm:inline">Stop</span>
            </Button>
          ) : null}
          {messages.length > 0 ? (
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
          className="absolute inset-0 overflow-y-auto overscroll-contain"
          onScroll={handleMessageScroll}
          ref={viewportRef}
        >
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
            {messages.length === 0 && agentStatus !== "resuming" ? (
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
                      onClick={() => onSuggestion(suggestion)}
                      type="button"
                      variant="outline"
                    >
                      {suggestion}
                    </Button>
                  ))}
                </EmptyContent>
              </Empty>
            ) : null}
            {agentStatus === "resuming" ? (
              <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-royal-gold" />
                Restoring conversation…
              </div>
            ) : null}
            {messages
              .filter((message) => !hiddenMessageIds[message.id])
              .map((message) => (
                <AgentMessage
                  canRespond={!busy}
                  isStreaming={agentStatus === "streaming"}
                  key={message.id}
                  annotations={
                    messageAnnotations[message.id] ??
                    (message.metadata?.optimistic
                      ? (pendingMessageAnnotations ?? undefined)
                      : undefined)
                  }
                  onAction={onAction}
                  onEditMessage={onEditMessage}
                  message={message}
                  onInputResponses={onRespond}
                />
              ))}
            {subagentActivities.length > 0 ? (
              <section
                aria-label="Delegated specialist work"
                className="flex flex-col gap-2"
              >
                {subagentActivities.map((activity) => (
                  <AgentSubagentActivity
                    activity={activity}
                    key={activity.callId}
                  />
                ))}
              </section>
            ) : null}
            {agentStatus === "streaming" ? (
              <div className="flex items-center gap-2 self-start rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                Live response · assembling the next operation step…
              </div>
            ) : null}
            {agentError ? (
              <Alert variant="destructive">
                <AlertTitle>The agent could not continue</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>{agentError.message}</span>
                  <Button
                    onClick={onRetry}
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
            {archiveError ? (
              <Alert variant="destructive">
                <AlertTitle>The conversation could not be archived</AlertTitle>
                <AlertDescription>{archiveError}</AlertDescription>
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
    </div>
  );
}
